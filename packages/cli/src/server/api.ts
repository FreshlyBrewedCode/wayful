// The read-only JSON surface the Wayful viewer consumes. Its shapes are the
// ones `wayful … --json` prints, because they are built from the same backend
// and the same pure domain functions the commands use — the viewer cannot
// disagree with the CLI about the state of a map.
//
// Every function here is total: a failure becomes an `error` field in the
// payload rather than a rejected request, which is what lets the viewer render
// a broken project instead of a blank page.

import { Effect, Option, Result } from "effect";

import { WayfulBackend, type MapHandle, type ProjectHandle } from "../backend/Backend";
import { fail, resolveMap, resolveProject } from "../context";
import type { MapMetadataError, WayfulError } from "../domain/errors";
import type {
  ArtifactRecord,
  GoalRecord,
  MapMetadata,
  MapSnapshot,
  StepRecord,
  TypeDefinition,
} from "../domain/model";
import { mapStatus, type MapStatus } from "../domain/status";
import { validateMap } from "../domain/validate";

export interface ErrorPayload {
  readonly error: string;
}

export interface ProjectPayload {
  readonly root: string;
  readonly description: string;
  readonly error?: string;
}

export interface MapSummaryPayload extends MapMetadata {
  readonly status: MapStatus | null;
}

export interface OverviewPayload {
  readonly project: ProjectPayload;
  readonly maps: readonly MapSummaryPayload[];
  readonly types: readonly TypeDefinition[];
  readonly error?: string;
}

export interface ValidationPayload {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** `map show`'s shape: the metadata with its collections folded in. */
export interface MapViewPayload extends MapMetadata {
  readonly goals: readonly GoalRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly steps: readonly StepRecord[];
}

export interface MapDetailPayload {
  readonly map: MapViewPayload;
  readonly status: MapStatus | null;
  readonly next: readonly number[];
  readonly validation: ValidationPayload | null;
}

export interface StepDetailPayload extends StepRecord {
  readonly instructions: string;
}

/**
 * The project directory the server was started with. Requests never consult
 * `WAYFUL_PROJECT` or `WAYFUL_MAP`: an ambient shell value must not be able to
 * point a running server at a project other than the one it announced.
 */
export type ProjectHint = string;

type Api<A> = Effect.Effect<A, never, WayfulBackend>;
type Read<A> = Effect.Effect<A, WayfulError | MapMetadataError, WayfulBackend>;

const openProject = (hint: ProjectHint) => resolveProject(Option.some(hint));

/**
 * Resolves a map by explicit name only. An absent name is the CLI's own
 * missing-context failure rather than a fallback to `WAYFUL_MAP`.
 */
function openMap(project: ProjectHandle, name: string): Read<MapHandle> {
  return resolveMap(name.trim() === "" ? Option.none() : Option.some(name), project);
}

/** Everything a map-scoped response is assembled from, read once. */
function readMap(map: MapHandle): Effect.Effect<MapSnapshot, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    return {
      map: map.metadata,
      steps: yield* backend.listSteps(map),
      artifacts: yield* backend.listArtifacts(map),
      goals: yield* backend.listGoals(map),
      types: yield* backend.listTypes(map.project),
    };
  });
}

const view = (snapshot: MapSnapshot): MapViewPayload => ({
  ...snapshot.map,
  goals: snapshot.goals,
  artifacts: snapshot.artifacts,
  steps: snapshot.steps,
});

const status = (snapshot: MapSnapshot): MapStatus =>
  mapStatus(snapshot.map, snapshot.steps, snapshot.artifacts, snapshot.goals);

/** Turns a read failure into the `{error}` body the viewer knows how to show. */
function orError<A>(read: Read<A>): Api<A | ErrorPayload> {
  return Effect.result(read).pipe(
    Effect.map((result) =>
      Result.isSuccess(result) ? result.success : { error: result.failure.message },
    ),
  );
}

/** `GET /api/overview` — the project, every map's status, and the type library. */
export function overview(hint: ProjectHint): Api<OverviewPayload> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    const opened = yield* Effect.result(openProject(hint));
    if (Result.isFailure(opened))
      return {
        project: { root: hint, description: "", error: opened.failure.message },
        maps: [],
        types: [],
      };
    const project = opened.success;
    const maps = yield* Effect.result(backend.listMaps(project));
    const types = yield* Effect.result(backend.listTypes(project));
    const summaries: MapSummaryPayload[] = [];
    for (const metadata of Result.isSuccess(maps) ? maps.success : []) {
      // A map that has become unreadable since it was listed still belongs on
      // screen; it reports no status rather than sinking the whole overview.
      const snapshot = yield* Effect.result(
        openMap(project, metadata.name).pipe(Effect.flatMap(readMap)),
      );
      summaries.push({
        ...metadata,
        status: Result.isSuccess(snapshot) ? status(snapshot.success) : null,
      });
    }
    return {
      project: { root: project.root, description: project.description },
      maps: summaries,
      types: Result.isSuccess(types) ? types.success : [],
      error: Result.isFailure(maps) ? maps.failure.message : undefined,
    };
  });
}

/** `GET /api/map` — show, status, next, and validate in a single round trip. */
export function mapDetail(hint: ProjectHint, name: string): Api<MapDetailPayload | ErrorPayload> {
  return orError(
    Effect.gen(function* () {
      const project = yield* openProject(hint);
      const map = yield* openMap(project, name);
      const snapshot = yield* readMap(map);
      const current = status(snapshot);
      const errors = validateMap(snapshot, { includeProgress: true });
      return {
        map: view(snapshot),
        status: current,
        next: current.next.map((step) => step.id),
        validation: { valid: errors.length === 0, errors },
      };
    }),
  );
}

/** `GET /api/step` — a step with its body and its type's current instructions. */
export function stepDetail(
  hint: ProjectHint,
  mapName: string,
  reference: string,
): Api<StepDetailPayload | ErrorPayload> {
  return orError(
    Effect.gen(function* () {
      const backend = yield* WayfulBackend;
      const project = yield* openProject(hint);
      const map = yield* openMap(project, mapName);
      const steps = yield* backend.listSteps(map);
      const target = /^\d+$/.test(reference)
        ? steps.find((step) => step.id === Number(reference))
        : steps.find((step) => step.name === reference);
      if (!target) return yield* fail(`step '${reference}' does not exist.`);
      const instructions = yield* backend.getType(project, target.type).pipe(
        Effect.map((type) => type.instructions),
        Effect.catch(() => Effect.succeed("unavailable: referenced type is missing or malformed.")),
      );
      return { ...target, instructions };
    }),
  );
}
