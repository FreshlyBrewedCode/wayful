import { Effect, Layer, Ref } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "../../domain/errors";
import { attachmentOK } from "../../domain/graph";
import { identifier, nonEmpty } from "../../domain/identifier";
import {
  closesStep,
  type CollectionRead,
  type DecodeError,
  type GoalRecord,
  type MapMetadata,
  type NewGoalRecord,
  type NewStepRecord,
  type StepRecord,
  type StepStatus,
} from "../../domain/model";
import { liftSync } from "../effect";
import { MapStore, type MapHandle } from "../MapStore";
import type { ProjectHandle } from "../ProjectStore";
import {
  addBlockedBy,
  addLabels,
  addSubIssue,
  createIssue,
  ensureLabel,
  getIssue,
  listBlockedBy,
  listIssues,
  listSubIssues,
  removeBlockedBy,
  removeLabel,
  updateIssue,
  type IssuePatch,
} from "./api";
import { GithubCredentials } from "./credentials";
import {
  decodeGoalIssue,
  encodeGoalBody,
  INITIAL_GOAL_NAME,
  INITIAL_GOAL_REQUIRED_OUTPUTS,
} from "./goal";
import { encodeIssueBody, type GithubIssue } from "./issue";
import {
  WAYFUL_BLOCKED_LABEL,
  WAYFUL_GOAL_LABEL,
  WAYFUL_MAP_LABEL,
  WAYFUL_STEP_LABEL,
  wayfulTypeLabel,
  wayfulTypeLabelDefinition,
} from "./labels";
import { decodeMapIssue, mapIssueData } from "./map";
import { resolveRepo, type ResolvedRepo } from "./repo";
import { decodeStepIssue, dependencyOutsideMapError, stepIssueData } from "./step";
import { SUB_ISSUE_CAP, subIssueCapError } from "./subIssues";

const fail = (message: string) => Effect.fail(new WayfulError({ message }));

function describeError(error: unknown): string {
  return error instanceof WayfulError ? error.message : String(error);
}

/**
 * A map's `wayful:step` sub-issues keyed by issue number → database id. Only a
 * `wayful:step` child is a valid dependency, and the database id is what a
 * native `blocked_by` edge is addressed by.
 */
function stepIdsFrom(issues: readonly GithubIssue[]): Map<number, number> {
  const ids = new Map<number, number>();
  for (const issue of issues)
    if (issue.labels.includes(WAYFUL_STEP_LABEL)) ids.set(issue.number, issue.id);
  return ids;
}

/** Throws the named cross-map error for the first dependency absent from `stepIds`. */
function assertDependenciesInMap(
  dependencies: Iterable<number>,
  stepIds: ReadonlyMap<number, number>,
): void {
  for (const dependency of dependencies)
    if (!stepIds.has(dependency)) throw dependencyOutsideMapError(dependency);
}

/**
 * The first sub-issue that decodes as a goal named `name`, if any. Goals are
 * addressed by name, so a save has to find the issue the name resolves to; an
 * undecodable sibling is skipped rather than blocking the search.
 */
function findGoalIssue(issues: readonly GithubIssue[], name: string): GithubIssue | undefined {
  for (const issue of issues) {
    if (!issue.labels.includes(WAYFUL_GOAL_LABEL)) continue;
    try {
      if (decodeGoalIssue(issue).name === name) return issue;
    } catch {
      // fall through to the next candidate
    }
  }
  return undefined;
}

/** The status as GitHub's native state and reason; blocked is a label, not a state. */
function nativeState(status: StepStatus): {
  readonly state: "open" | "closed";
  readonly state_reason?: "completed" | "not_planned";
} {
  switch (status) {
    case "pending":
    case "blocked":
      return { state: "open" };
    case "complete":
      return { state: "closed", state_reason: "completed" };
    case "cancelled":
      return { state: "closed", state_reason: "not_planned" };
  }
}

/**
 * The GitHub `MapStore`. Maps are issues labelled `wayful:map`; a map's title
 * is its `start` and its body carries `name` and the remaining structured
 * fields. Reads list label-filtered issues — never the Search API, which is
 * eventually consistent — and closed map issues are simply absent, the same
 * effect as deleting a map folder. Steps are `wayful:step` sub-issues whose
 * issue number *is* their id; goals are `wayful:goal` sub-issues addressed by
 * name, closing as `completed` once every required output slot is filled.
 *
 * The infrastructure services are resolved once at construction and closed
 * over, so the returned methods carry no environment of their own: a layer
 * whose methods leak requirements would appear to be provided while failing at
 * the first call.
 */
export function makeGithubMapStore() {
  return Effect.gen(function* () {
    const credentials = yield* GithubCredentials;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const http = yield* HttpClient.HttpClient;
    const cache = yield* Ref.make(new Map<string, ResolvedRepo>());

    const withInfra = <A, E>(
      effect: Effect.Effect<A, E, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner>,
    ) =>
      effect.pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

    // One project means one repo + token for the life of the process; the
    // per-project cache keeps a command from resolving them per call.
    const context = (project: ProjectHandle) =>
      withInfra(
        Effect.gen(function* () {
          const existing = (yield* Ref.get(cache)).get(project.root);
          if (existing !== undefined) return existing;
          const resolved = yield* resolveRepo(project, credentials);
          yield* Ref.update(cache, (map) => new Map(map).set(project.root, resolved));
          return resolved;
        }),
      );

    /** A map's issue number is its native address; every sub-issue op needs it. */
    const mapNumber = (map: MapHandle) =>
      map.number === undefined
        ? fail(`map '${map.name}' is missing its github issue number.`)
        : Effect.succeed(map.number);

    // Reads every open `wayful:map` issue once, decoding each into metadata and
    // keeping the issue number the decoder cannot carry (metadata is portable
    // across backends; the number is not).
    const readMaps = (project: ProjectHandle) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(project);
          const issues = yield* listIssues(ref, token, {
            labels: [WAYFUL_MAP_LABEL],
            state: "open",
          });
          const records: MapMetadata[] = [];
          const errors: DecodeError[] = [];
          const numbers = new Map<string, number>();
          for (const issue of issues) {
            // `state=open` already excludes closed issues server-side; this is
            // the belt to that braces, so a closed map is never returned.
            if (issue.state !== "open") continue;
            try {
              const metadata = decodeMapIssue(issue);
              records.push(metadata);
              numbers.set(metadata.name, issue.number);
            } catch (error) {
              errors.push({ file: `#${issue.number}`, message: describeError(error) });
            }
          }
          return { records, errors, numbers };
        }),
      );

    const listMaps = (project: ProjectHandle) =>
      readMaps(project).pipe(
        Effect.map(({ records, errors }) => ({
          records: records.toSorted((a, b) => a.name.localeCompare(b.name)),
          errors,
        })),
      );

    const createMap = (
      project: ProjectHandle,
      {
        name,
        start,
        goal,
        goalBody,
      }: {
        readonly name: string;
        readonly start: string;
        readonly goal: string;
        readonly goalBody: string;
      },
    ) =>
      withInfra(
        Effect.gen(function* () {
          yield* liftSync(() => identifier(name, "map name", true));
          const trimmedStart = yield* liftSync(() => nonEmpty(start, "map start"));
          const trimmedGoal = yield* liftSync(() => nonEmpty(goal, "map goal"));
          const { records } = yield* readMaps(project);
          if (records.some((map) => map.name === name))
            return yield* fail(`map '${name}' already exists.`);
          const { ref, token } = yield* context(project);
          const map = yield* createIssue(ref, token, {
            title: trimmedStart,
            body: encodeIssueBody("", mapIssueData(name)),
            labels: [WAYFUL_MAP_LABEL],
          });
          // A map is born with one goal, itself a sub-issue, so the map is
          // immediately workable. The default goal carries the same
          // `evidence`/`artifact` slot the filesystem backend writes.
          const initialGoal = yield* createIssue(ref, token, {
            title: trimmedGoal,
            body: encodeGoalBody({
              name: INITIAL_GOAL_NAME,
              outputs: [],
              required_outputs: INITIAL_GOAL_REQUIRED_OUTPUTS,
              body: goalBody,
            }),
            labels: [WAYFUL_GOAL_LABEL],
          });
          yield* addSubIssue(ref, token, map.number, initialGoal.id);
        }),
      );

    const openMap = (project: ProjectHandle, name: string) =>
      withInfra(
        Effect.gen(function* () {
          yield* liftSync(() => identifier(name, "map name", true));
          const { records, numbers } = yield* readMaps(project);
          const metadata = records.find((candidate) => candidate.name === name);
          if (metadata === undefined) return yield* fail(`map '${name}' does not exist.`);
          return { project, name, metadata, number: numbers.get(name) };
        }),
      );

    const listSteps = (map: MapHandle): Effect.Effect<CollectionRead<StepRecord>, WayfulError> =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const parent = yield* mapNumber(map);
          const issues = yield* listSubIssues(ref, token, parent);
          // Sub-issues are steps and goals together; a goal (or a foreign
          // sub-issue) is not a step and is skipped, not an error.
          const stepIds = stepIdsFrom(issues);
          const records: StepRecord[] = [];
          const errors: DecodeError[] = [];
          for (const issue of issues) {
            if (!issue.labels.includes(WAYFUL_STEP_LABEL)) continue;
            // A step's dependencies are native `blocked_by` edges and so are a
            // second read per step. An API failure fails the whole listing
            // rather than masquerading as a malformed record.
            const blockedBy = yield* listBlockedBy(ref, token, issue.number);
            const dependencies = blockedBy.map((blocking) => blocking.number);
            try {
              // Issue numbers are repo-global, so a `blocked_by` edge can point
              // anywhere in the repo. Only a `wayful:step` sub-issue of this
              // same map is a valid dependency.
              assertDependenciesInMap(dependencies, stepIds);
              records.push(decodeStepIssue(issue, dependencies));
            } catch (error) {
              errors.push({ file: `#${issue.number}`, message: describeError(error) });
            }
          }
          return { records: records.toSorted((a, b) => a.id - b.id), errors };
        }),
      );

    const createStep = (map: MapHandle, step: NewStepRecord) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const parent = yield* mapNumber(map);
          const existing = yield* listSubIssues(ref, token, parent);
          if (existing.length >= SUB_ISSUE_CAP) return yield* Effect.fail(subIssueCapError());
          // Dependencies are validated against the map's existing step
          // sub-issues before the issue is created, so a foreign edge fails
          // without leaving a half-built step behind. The same lookup resolves
          // each blocking issue's database id for the native edge.
          const stepIds = stepIdsFrom(existing);
          yield* liftSync(() => assertDependenciesInMap(step.dependencies, stepIds));
          // Types live on disk and are maintained by hand, so the label for a
          // type is created on demand here; the sync command is the re-runnable
          // sweep for type files added without a `step create`.
          yield* ensureLabel(ref, token, wayfulTypeLabelDefinition(step.type));
          const created = yield* createIssue(ref, token, {
            title: step.description,
            body: encodeIssueBody(step.body, stepIssueData(step)),
            labels: [WAYFUL_STEP_LABEL, wayfulTypeLabel(step.type)],
          });
          yield* addSubIssue(ref, token, parent, created.id);
          for (const dependency of step.dependencies)
            yield* addBlockedBy(ref, token, created.number, stepIds.get(dependency)!);
          // A record may be created non-pending (the shared interface allows
          // it, as the filesystem backend does); apply the status natively
          // rather than returning a status the issue does not carry.
          if (step.status === "blocked")
            yield* addLabels(ref, token, created.number, [WAYFUL_BLOCKED_LABEL]);
          else if (closesStep(step.status))
            yield* updateIssue(ref, token, created.number, nativeState(step.status));
          return {
            ...step,
            id: created.number,
            created_at: created.created_at,
            updated_at: created.updated_at,
            closed_at: closesStep(step.status)
              ? (created.closed_at ?? created.updated_at)
              : undefined,
          } satisfies StepRecord;
        }),
      );

    // NOT ATOMIC. A `saveStep` is a body/title edit, a state change, a label
    // reconcile and a dependency diff sent as separate field-scoped mutations,
    // with no transaction between them: GitHub offers no `If-Match` on issue
    // edits, and unlike the filesystem's single-writer assumption a human in
    // the GitHub UI is a real second writer. Only the body/title mutation is
    // exposed to a lost update; the state mutation, the label reconcile and
    // the dependency diff never send the body, and every mutation is diffed
    // against a fresh read so a no-op one is not sent at all.
    const saveStep = (map: MapHandle, step: StepRecord) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const issue = yield* getIssue(ref, token, step.id);
          // Dependencies are native `blocked_by` edges, absent from the issue
          // object, so the current set is a second read.
          const blockedBy = yield* listBlockedBy(ref, token, step.id);
          const current = yield* liftSync(() =>
            decodeStepIssue(
              issue,
              blockedBy.map((blocking) => blocking.number),
            ),
          );

          // The dependency diff is validated before any mutation, so a foreign
          // edge fails the save before it can make a partial write. Every
          // desired dependency must be a `wayful:step` sub-issue of this map —
          // an issue number is repo-global, so only a child of this map is
          // valid — and looking them up also resolves the database ids native
          // edges are addressed by.
          const currentDependencies = new Set(current.dependencies);
          const desiredDependencies = new Set(step.dependencies);
          const added = [...desiredDependencies].filter((id) => !currentDependencies.has(id));
          const removed = [...currentDependencies].filter((id) => !desiredDependencies.has(id));
          const stepIds =
            desiredDependencies.size > 0
              ? stepIdsFrom(yield* listSubIssues(ref, token, yield* mapNumber(map)))
              : new Map<number, number>();
          yield* liftSync(() => assertDependenciesInMap(desiredDependencies, stepIds));

          // The body carries the prose and the structured residue (slots,
          // attachments, and the reason/summary fields), so compare the full
          // encoded body, not just the prose: adding a block reason must reach
          // the body, while a hand-edited key order must not cause a rewrite.
          const bodyPatch: IssuePatch = {};
          if (step.description !== current.description) bodyPatch.title = step.description;
          const desiredBody = encodeIssueBody(step.body, stepIssueData(step));
          const currentBody = encodeIssueBody(current.body, stepIssueData(current));
          if (desiredBody !== currentBody) bodyPatch.body = desiredBody;
          yield* updateIssue(ref, token, step.id, bodyPatch);

          // The native state is separate from the reason fields: this mutation
          // never sends the body.
          const desired = nativeState(step.status);
          const currentNative = nativeState(current.status);
          if (
            desired.state !== currentNative.state ||
            desired.state_reason !== currentNative.state_reason
          ) {
            yield* updateIssue(ref, token, step.id, {
              state: desired.state,
              ...(desired.state_reason !== undefined ? { state_reason: desired.state_reason } : {}),
            });
          }

          const desiredLabels = [
            WAYFUL_STEP_LABEL,
            wayfulTypeLabel(step.type),
            ...(step.status === "blocked" ? [WAYFUL_BLOCKED_LABEL] : []),
          ];
          const present = new Set(issue.labels);
          yield* addLabels(
            ref,
            token,
            step.id,
            desiredLabels.filter((label) => !present.has(label)),
          );
          if (present.has(WAYFUL_BLOCKED_LABEL) && step.status !== "blocked")
            yield* removeLabel(ref, token, step.id, WAYFUL_BLOCKED_LABEL);

          // The dependency edges themselves, never the body. Additions use the
          // database ids resolved above; removals use the ids of the edges
          // already read back, so an already-absent edge is never a request.
          const blockingIds = new Map(
            blockedBy.map((blocking) => [blocking.number, blocking.id] as const),
          );
          for (const dependency of added)
            yield* addBlockedBy(ref, token, step.id, stepIds.get(dependency)!);
          for (const dependency of removed) {
            const blockingId = blockingIds.get(dependency);
            if (blockingId !== undefined) yield* removeBlockedBy(ref, token, step.id, blockingId);
          }
        }),
      );

    const listGoals = (map: MapHandle): Effect.Effect<CollectionRead<GoalRecord>, WayfulError> =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const parent = yield* mapNumber(map);
          const issues = yield* listSubIssues(ref, token, parent);
          const records: GoalRecord[] = [];
          const errors: DecodeError[] = [];
          for (const issue of issues) {
            // Sub-issues are steps and goals together; a step (or a foreign
            // sub-issue) is not a goal and is skipped, not an error. A goal's
            // kind lives on its label, so a de-labelled goal is data loss.
            if (!issue.labels.includes(WAYFUL_GOAL_LABEL)) continue;
            try {
              records.push(decodeGoalIssue(issue));
            } catch (error) {
              errors.push({ file: `#${issue.number}`, message: describeError(error) });
            }
          }
          return { records: records.toSorted((a, b) => a.name.localeCompare(b.name)), errors };
        }),
      );

    const createGoal = (map: MapHandle, goal: NewGoalRecord) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const parent = yield* mapNumber(map);
          // One listing answers both questions: the goal already exists, and
          // whether the shared step/goal sub-issue budget is full.
          const existing = yield* listSubIssues(ref, token, parent);
          if (findGoalIssue(existing, goal.name) !== undefined)
            return yield* fail(`goal '${goal.name}' already exists.`);
          if (existing.length >= SUB_ISSUE_CAP) return yield* Effect.fail(subIssueCapError());
          const created = yield* createIssue(ref, token, {
            title: goal.description,
            body: encodeGoalBody(goal),
            labels: [WAYFUL_GOAL_LABEL],
          });
          yield* addSubIssue(ref, token, parent, created.id);
        }),
      );

    // NOT ATOMIC, like `saveStep`: a body/title edit and a state change sent as
    // separate field-scoped mutations with no transaction. Satisfaction is read
    // from slot state — every required output filled closes the issue as
    // `completed` — never a body flag or a label, so a state change never
    // rewrites the body.
    const saveGoal = (map: MapHandle, goal: GoalRecord) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const parent = yield* mapNumber(map);
          const issues = yield* listSubIssues(ref, token, parent);
          const target = findGoalIssue(issues, goal.name);
          if (target === undefined) return yield* fail(`goal '${goal.name}' does not exist.`);
          const current = yield* liftSync(() => decodeGoalIssue(target));

          // Compare the full encoded body, not just the prose: attachments live
          // in the residue, so filling an output slot must reach the body.
          const patch: IssuePatch = {};
          if (goal.description !== current.description) patch.title = goal.description;
          const desiredBody = encodeGoalBody(goal);
          const currentBody = encodeGoalBody(current);
          if (desiredBody !== currentBody) patch.body = desiredBody;
          yield* updateIssue(ref, token, target.number, patch);

          const satisfied = attachmentOK(goal.required_outputs, goal.outputs);
          const desiredState = satisfied ? "closed" : "open";
          if (target.state !== desiredState) {
            yield* updateIssue(
              ref,
              token,
              target.number,
              satisfied ? { state: "closed", state_reason: "completed" } : { state: "open" },
            );
          }
        }),
      );

    return MapStore.of({
      listMaps,
      createMap,
      openMap,
      listSteps,
      createStep,
      saveStep,
      listGoals,
      createGoal,
      saveGoal,
      // The one-query snapshot — map, steps, goals, types, labels — is the
      // GraphQL slice (#39). Until then this backend reports the map alone
      // rather than composing a partial snapshot from several round trips;
      // commands that need steps read them through `listSteps`.
      snapshot: (map) =>
        Effect.succeed({
          snapshot: { map: map.metadata, steps: [], artifacts: [], goals: [], types: [] },
          errors: [],
        }),
    });
  });
}

export const GithubMapStore = Layer.effect(MapStore, makeGithubMapStore());
