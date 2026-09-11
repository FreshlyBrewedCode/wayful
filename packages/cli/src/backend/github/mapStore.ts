import { Effect, Layer, Ref } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "../../domain/errors";
import { identifier, nonEmpty } from "../../domain/identifier";
import {
  closesStep,
  type CollectionRead,
  type DecodeError,
  type MapMetadata,
  type NewStepRecord,
  type StepRecord,
  type StepStatus,
} from "../../domain/model";
import { liftSync } from "../effect";
import { MapStore, type MapHandle } from "../MapStore";
import type { ProjectHandle } from "../ProjectStore";
import {
  addLabels,
  addSubIssue,
  createIssue,
  ensureLabel,
  getIssue,
  listIssues,
  listSubIssues,
  removeLabel,
  updateIssue,
  type IssuePatch,
} from "./api";
import { GithubCredentials } from "./credentials";
import { encodeIssueBody } from "./issue";
import {
  WAYFUL_BLOCKED_LABEL,
  WAYFUL_MAP_LABEL,
  WAYFUL_STEP_LABEL,
  wayfulTypeLabel,
  wayfulTypeLabelDefinition,
} from "./labels";
import { decodeMapIssue, mapIssueData } from "./map";
import { resolveRepo, type ResolvedRepo } from "./repo";
import { decodeStepIssue, stepIssueData } from "./step";
import { SUB_ISSUE_CAP, subIssueCapError } from "./subIssues";

const fail = (message: string) => Effect.fail(new WayfulError({ message }));

const unsupported = (what: string) => fail(`the github backend does not support ${what} yet.`);

function describeError(error: unknown): string {
  return error instanceof WayfulError ? error.message : String(error);
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
 * issue number *is* their id; goals are the next slice (#37).
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

    // `goal`/`goalBody` are accepted by the shared interface but not created
    // here yet: the initial goal is a sub-issue, which #37 adds along with the
    // rest of the goal machinery. Until then a GitHub map simply has no goal,
    // rather than a loose issue masquerading as one.
    const createMap = (
      project: ProjectHandle,
      {
        name,
        start,
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
          const { records } = yield* readMaps(project);
          if (records.some((map) => map.name === name))
            return yield* fail(`map '${name}' already exists.`);
          const { ref, token } = yield* context(project);
          yield* createIssue(ref, token, {
            title: trimmedStart,
            body: encodeIssueBody("", mapIssueData(name)),
            labels: [WAYFUL_MAP_LABEL],
          });
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
          const records: StepRecord[] = [];
          const errors: DecodeError[] = [];
          for (const issue of issues) {
            // Sub-issues are steps and goals together; a goal (or a foreign
            // sub-issue) is not a step and is skipped, not an error.
            if (!issue.labels.includes(WAYFUL_STEP_LABEL)) continue;
            try {
              records.push(decodeStepIssue(issue));
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

    // NOT ATOMIC. A `saveStep` is a body/title edit, a state change and a label
    // reconcile sent as separate field-scoped mutations, with no transaction
    // between them: GitHub offers no `If-Match` on issue edits, and unlike the
    // filesystem's single-writer assumption a human in the GitHub UI is a real
    // second writer. Only the body/title mutation is exposed to a lost update;
    // the state mutation and the label reconcile never send the body, and every
    // mutation is diffed against a fresh read so a no-op one is not sent at all.
    const saveStep = (map: MapHandle, step: StepRecord) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(map.project);
          const issue = yield* getIssue(ref, token, step.id);
          const current = yield* liftSync(() => decodeStepIssue(issue));

          // Dependencies are native issue dependencies, a later slice (#38).
          // Failing here keeps `step depends` from reporting success while the
          // edge silently goes nowhere.
          if (
            step.dependencies.length !== current.dependencies.length ||
            step.dependencies.some((id, index) => id !== current.dependencies[index])
          )
            return yield* fail("the github backend does not support step dependencies yet.");

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
        }),
      );

    return MapStore.of({
      listMaps,
      createMap,
      openMap,
      listSteps,
      createStep,
      saveStep,
      listGoals: () => unsupported("goals"),
      createGoal: () => unsupported("goals"),
      saveGoal: () => unsupported("goals"),
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
