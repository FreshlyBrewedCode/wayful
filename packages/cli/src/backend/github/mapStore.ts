import { Effect, Fiber, FileSystem, Layer, Path, Redacted, Ref, Result, Schedule } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "@domain/errors";
import { attachmentOK, deriveArtifacts } from "@domain/graph";
import { identifier, nonEmpty } from "@domain/identifier";
import {
  closesStep,
  type CollectionRead,
  type DecodeError,
  type GoalRecord,
  type MapMetadata,
  type MapSnapshot,
  type NewGoalRecord,
  type NewStepRecord,
  type StepRecord,
  type StepStatus,
  type TypeDefinition,
} from "@domain/model";
import { makeReadArtifact } from "@backend/artifacts";
import { liftSync } from "@backend/effect";
import { MapStore, type MapHandle, type SubIssueUsage } from "@backend/MapStore";
import { ProjectStore, type ProjectHandle } from "@backend/ProjectStore";
import {
  addBlockedBy,
  addLabels,
  addSubIssue,
  createIssue,
  deleteIssue,
  ensureLabel,
  listIssues,
  listSubIssues,
  removeBlockedBy,
  removeLabel,
  updateIssue,
  type IssuePatch,
} from "@backend/github/api";
import { GithubCredentials } from "@backend/github/credentials";
import {
  decodeGoalIssue,
  encodeGoalBody,
  INITIAL_GOAL_NAME,
  INITIAL_GOAL_REQUIRED_OUTPUTS,
} from "@backend/github/goal";
import { readMapSnapshot, type SnapshotChild } from "@backend/github/graphql";
import { GithubHttp } from "@backend/github/http";
import { encodeIssueBody, type GithubIssue } from "@backend/github/issue";
import {
  WAYFUL_BLOCKED_LABEL,
  WAYFUL_GOAL_LABEL,
  WAYFUL_MAP_LABEL,
  WAYFUL_STEP_LABEL,
  wayfulTypeLabel,
  wayfulTypeLabelDefinition,
} from "@backend/github/labels";
import { decodeMapIssue, mapIssueData } from "@backend/github/map";
import { resolveRepo, type ResolvedRepo } from "@backend/github/repo";
import type { GitRemoteRef } from "@backend/github/remote";
import { readRevision, REVISION_POLL_MS } from "@backend/github/revision";
import { decodeStepIssue, dependencyOutsideMapError, stepIssueData } from "@backend/github/step";
import { SUB_ISSUE_CAP, subIssueCapError } from "@backend/github/subIssues";

const fail = (message: string) => Effect.fail(new WayfulError({ message }));

function describeError(error: unknown): string {
  return error instanceof WayfulError ? error.message : String(error);
}

/**
 * Cleans up an issue this run just created when the link that would have made
 * it part of a map failed. GitHub has no transaction spanning issue creation
 * and sub-issue linking, so without this the run leaves an unreferenced wayful
 * issue behind. Best-effort: the original failure is what the caller reports,
 * and a failed cleanup is swallowed rather than masking it.
 */
function discardCreated(
  ref: GitRemoteRef,
  token: Redacted.Redacted<string>,
  created: GithubIssue,
): Effect.Effect<void, never, GithubHttp> {
  return created.node_id === undefined
    ? Effect.void
    : deleteIssue(ref, token, created.node_id).pipe(Effect.ignore);
}

/** The memoization key for a map's snapshot: one project, one map. */
const snapshotKey = (map: MapHandle) => `${map.project.root}#${map.number ?? map.name}`;

/**
 * The snapshot a read returns, plus every record it could not decode. The
 * per-collection error lists and the native addresses of the decoded records
 * ride along so `listSteps`/`listGoals` and the `save*` methods answer from one
 * snapshot instead of issuing their own collection reads.
 */
interface SnapshotRead {
  readonly snapshot: MapSnapshot;
  readonly errors: readonly DecodeError[];
  readonly stepErrors: readonly DecodeError[];
  readonly goalErrors: readonly DecodeError[];
  /** A `wayful:step` child's issue number → its GitHub database id, the address a native `blocked_by` edge uses. */
  readonly stepIds: ReadonlyMap<number, number>;
  /** Every decodable goal keyed by name, carrying the issue a save has to mutate. */
  readonly goalIssues: ReadonlyMap<string, GithubIssue>;
  /** Every sub-issue of the map, decodable or not — the shared budget steps and goals spend. */
  readonly subIssueCount: number;
  /** How much of the shared step/goal sub-issue budget the map has used. */
  readonly capacity: SubIssueUsage;
}

/**
 * Folds one GraphQL snapshot into the domain shape: the map's own metadata,
 * every decodable step (with its native dependencies) and goal, the artifacts
 * those attachments derive, and the project's type library. A record that
 * fails to decode is collected as a `DecodeError` rather than sinking its
 * siblings — the same skip-and-collect contract every other read follows.
 */
function assembleSnapshot(
  map: MapHandle,
  children: readonly SnapshotChild[],
  typeRead: CollectionRead<TypeDefinition>,
): SnapshotRead {
  const steps: StepRecord[] = [];
  const goals: GoalRecord[] = [];
  const stepErrors: DecodeError[] = [];
  const goalErrors: DecodeError[] = [];
  const stepIds = stepIdsFrom(children.map((child) => child.issue));
  const goalIssues = new Map<string, GithubIssue>();
  for (const child of children) {
    const issue = child.issue;
    if (issue.labels.includes(WAYFUL_STEP_LABEL)) {
      try {
        // Issue numbers are repo-global, so a `blocked_by` edge can point
        // anywhere in the repo. Only a `wayful:step` sub-issue of this map is
        // a valid dependency.
        assertDependenciesInMap(child.dependencies, stepIds);
        steps.push(decodeStepIssue(issue, child.dependencies));
      } catch (error) {
        stepErrors.push({ file: `#${issue.number}`, message: describeError(error) });
      }
    } else if (issue.labels.includes(WAYFUL_GOAL_LABEL)) {
      try {
        const goal = decodeGoalIssue(issue);
        goals.push(goal);
        goalIssues.set(goal.name, issue);
      } catch (error) {
        goalErrors.push({ file: `#${issue.number}`, message: describeError(error) });
      }
    }
  }
  steps.sort((a, b) => a.id - b.id);
  goals.sort((a, b) => a.name.localeCompare(b.name));
  return {
    snapshot: {
      map: map.metadata,
      steps,
      artifacts: deriveArtifacts(steps, goals),
      goals,
      types: typeRead.records,
    },
    errors: [...stepErrors, ...goalErrors, ...typeRead.errors],
    stepErrors,
    goalErrors,
    stepIds,
    goalIssues,
    subIssueCount: children.length,
    capacity: { used: children.length, cap: SUB_ISSUE_CAP },
  };
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
export const makeGithubMapStore = Effect.gen(function* () {
  const credentials = yield* GithubCredentials;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* GithubHttp;
  const projectStore = yield* ProjectStore;
  // Records come from the network, but refs still resolve against the local
  // checkout (see `readArtifact` below), which needs the same `FileSystem`/
  // `Path` services the filesystem backend closes over.
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cache = yield* Ref.make(new Map<string, ResolvedRepo>());
  // One command reads a map's snapshot at most once: a `map status` that
  // reaches for the same map twice must not pay for the GraphQL query twice.
  const snapshots = yield* Ref.make(new Map<string, SnapshotRead>());

  const withInfra = <A, E>(
    effect: Effect.Effect<A, E, GithubHttp | ChildProcessSpawner.ChildProcessSpawner>,
  ) =>
    effect.pipe(
      Effect.provideService(GithubHttp, http),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  /** A write invalidates the memoized snapshot so a later read in the same process sees it. */
  const invalidateSnapshot = (map: MapHandle) =>
    Ref.update(snapshots, (memo) => {
      const next = new Map(memo);
      next.delete(snapshotKey(map));
      return next;
    });

  /**
   * A poll that saw a change drops every memoized snapshot for the project,
   * so the next request re-reads instead of serving the pre-change snapshot
   * for the life of the process.
   */
  const invalidateProjectSnapshots = (project: ProjectHandle) =>
    Ref.update(snapshots, (memo) => {
      const next = new Map(memo);
      const prefix = `${project.root}#`;
      for (const key of next.keys()) if (key.startsWith(prefix)) next.delete(key);
      return next;
    });

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
          const decoded = yield* Effect.result(liftSync(() => decodeMapIssue(issue)));
          if (Result.isFailure(decoded))
            errors.push({ file: `#${issue.number}`, message: describeError(decoded.failure) });
          else {
            records.push(decoded.success);
            numbers.set(decoded.success.name, issue.number);
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
        yield* addSubIssue(ref, token, map.number, initialGoal.id).pipe(
          Effect.catch((error) =>
            discardCreated(ref, token, initialGoal).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
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

  // One GraphQL query assembles the map, its step and goal sub-issues, their
  // labels, native state and dependencies together — where composing
  // `listSteps` (a read per step for its `blocked_by` edges) and `listGoals`
  // would be several round trips. The result is memoized for the life of the
  // process, so a command that reaches for the same map twice fetches once;
  // a write to the map invalidates it. Every map-scoped read and write below
  // is assembled from this one snapshot.
  const snapshot = (map: MapHandle): Effect.Effect<SnapshotRead, WayfulError> =>
    withInfra(
      Effect.gen(function* () {
        const key = snapshotKey(map);
        const cached = (yield* Ref.get(snapshots)).get(key);
        if (cached !== undefined) return cached;
        const parent = yield* mapNumber(map);
        const { ref, token } = yield* context(map.project);
        const read = yield* readMapSnapshot(ref, token, parent);
        // Types stay on disk under every backend; reading them is a local,
        // unmetered concern, never part of the query.
        const types = yield* projectStore.listTypes(map.project);
        const assembled = assembleSnapshot(map, read.children, types);
        yield* Ref.update(snapshots, (memo) => new Map(memo).set(key, assembled));
        return assembled;
      }),
    );

  const listSteps = (map: MapHandle): Effect.Effect<CollectionRead<StepRecord>, WayfulError> =>
    snapshot(map).pipe(
      Effect.map((read) => ({ records: read.snapshot.steps, errors: read.stepErrors })),
    );

  const createStep = (map: MapHandle, step: NewStepRecord) =>
    withInfra(
      Effect.gen(function* () {
        const { ref, token } = yield* context(map.project);
        const parent = yield* mapNumber(map);
        const existing = yield* listSubIssues(ref, token, parent);
        if (existing.length >= SUB_ISSUE_CAP) return yield* subIssueCapError();
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
        yield* addSubIssue(ref, token, parent, created.id).pipe(
          Effect.catch((error) =>
            discardCreated(ref, token, created).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        for (const dependency of step.dependencies)
          yield* addBlockedBy(ref, token, created.number, stepIds.get(dependency)!);
        // A record may be created non-pending (the shared interface allows
        // it, as the filesystem backend does); apply the status natively
        // rather than returning a status the issue does not carry.
        if (step.status === "blocked")
          yield* addLabels(ref, token, created.number, [WAYFUL_BLOCKED_LABEL]);
        else if (closesStep(step.status))
          yield* updateIssue(ref, token, created.number, nativeState(step.status));
        yield* invalidateSnapshot(map);
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
        // The snapshot already carries the step and its native dependencies,
        // so a save re-reads neither the issue nor its `blocked_by` edges.
        const read = yield* snapshot(map);
        const current = read.snapshot.steps.find((candidate) => candidate.id === step.id);
        if (current === undefined) return yield* fail(`step #${step.id} does not exist.`);

        // The dependency diff is validated before any mutation, so a foreign
        // edge fails the save before it can make a partial write. Every
        // desired dependency must be a `wayful:step` sub-issue of this map —
        // an issue number is repo-global, so only a child of this map is
        // valid — and the snapshot's step ids also address the native edges.
        const currentDependencies = new Set(current.dependencies);
        const desiredDependencies = new Set(step.dependencies);
        const added = [...desiredDependencies].filter((id) => !currentDependencies.has(id));
        const removed = [...currentDependencies].filter((id) => !desiredDependencies.has(id));
        yield* liftSync(() => assertDependenciesInMap(desiredDependencies, read.stepIds));

        // The body carries the prose and the structured residue (slots,
        // attachments, and the reason/summary fields), so compare the full
        // encoded body, not just the prose: adding a block reason must reach
        // the body, while a hand-edited key order must not cause a rewrite.
        //
        // Removing the blocked label happens *before* the body edit. These
        // mutations are not transactional, so an interrupted unblock must leave
        // a decodable record: taking the label off first yields a pending step
        // with a stray reason (which still decodes), never a blocked step whose
        // reason has already been cleared. The block label is reconstructed
        // from the current status, since no fact is stored twice.
        const present = new Set([
          WAYFUL_STEP_LABEL,
          wayfulTypeLabel(current.type),
          ...(current.status === "blocked" ? [WAYFUL_BLOCKED_LABEL] : []),
        ]);
        if (present.has(WAYFUL_BLOCKED_LABEL) && step.status !== "blocked")
          yield* removeLabel(ref, token, step.id, WAYFUL_BLOCKED_LABEL);

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

        // Adding the blocked label comes *after* the body edit, so the reason
        // is already recorded when the label marks the step blocked.
        const desiredLabels = [
          WAYFUL_STEP_LABEL,
          wayfulTypeLabel(step.type),
          ...(step.status === "blocked" ? [WAYFUL_BLOCKED_LABEL] : []),
        ];
        yield* addLabels(
          ref,
          token,
          step.id,
          desiredLabels.filter((label) => !present.has(label)),
        );

        // The dependency edges themselves, never the body. Additions use the
        // snapshot's database ids; removals use the same ids, so an
        // already-absent edge is never a request.
        for (const dependency of added)
          yield* addBlockedBy(ref, token, step.id, read.stepIds.get(dependency)!);
        for (const dependency of removed) {
          const blockingId = read.stepIds.get(dependency);
          if (blockingId !== undefined) yield* removeBlockedBy(ref, token, step.id, blockingId);
        }
        yield* invalidateSnapshot(map);
      }),
    );

  const listGoals = (map: MapHandle): Effect.Effect<CollectionRead<GoalRecord>, WayfulError> =>
    snapshot(map).pipe(
      Effect.map((read) => ({ records: read.snapshot.goals, errors: read.goalErrors })),
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
        if (existing.length >= SUB_ISSUE_CAP) return yield* subIssueCapError();
        const created = yield* createIssue(ref, token, {
          title: goal.description,
          body: encodeGoalBody(goal),
          labels: [WAYFUL_GOAL_LABEL],
        });
        yield* addSubIssue(ref, token, parent, created.id).pipe(
          Effect.catch((error) =>
            discardCreated(ref, token, created).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        yield* invalidateSnapshot(map);
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
        // The snapshot already resolved every decodable goal to the issue the
        // save has to mutate, so no collection read is needed here.
        const read = yield* snapshot(map);
        const target = read.goalIssues.get(goal.name);
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
        yield* invalidateSnapshot(map);
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
    snapshot,
    // Records come from the network, but refs still resolve against the
    // local checkout: the project config and type files already require one,
    // and a missing checkout is a clear error rather than a crash.
    readArtifact: makeReadArtifact({ fs, path, snapshot }),
    // ETag polling stands in for the filesystem watcher: each tick revalidates
    // with conditional GETs, so an idle project spends no rate limit, and a
    // changed fingerprint invalidates the memoized snapshots before notifying.
    watch: (project, onChange) =>
      withInfra(
        Effect.gen(function* () {
          const services = yield* Effect.context();
          const { ref, token } = yield* context(project);
          const revision = withInfra(readRevision(ref, token));
          const previous = yield* Ref.make<string | undefined>(undefined);
          const tick = Effect.gen(function* () {
            const next = yield* revision;
            const last = yield* Ref.get(previous);
            if (last !== undefined && next !== last) {
              yield* invalidateProjectSnapshots(project);
              onChange();
            }
            yield* Ref.set(previous, next);
            // A failed poll is not fatal; the next tick retries.
          }).pipe(Effect.ignore);
          // `Effect.repeat` runs `tick` once immediately, then again on
          // every `Schedule.spaced` step; because each step only starts
          // after the previous one settles, ticks can never overlap, which
          // is what the old `inFlight` flag guarded against by hand.
          const fiber = yield* Effect.repeat(tick, Schedule.spaced(REVISION_POLL_MS)).pipe(
            Effect.forkDetach,
          );
          return () => {
            Effect.runForkWith(services)(Fiber.interrupt(fiber));
          };
        }),
      ),
  });
});

export const GithubMapStore = Layer.effect(MapStore, makeGithubMapStore);
