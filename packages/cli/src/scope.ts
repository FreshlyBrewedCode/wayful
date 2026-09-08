import { Effect, Option } from "effect";

import { WayfulBackend, type MapHandle, type ProjectHandle } from "./backend/Backend";
import { MapMetadataError, WayfulError } from "./domain/errors";
import type { CollectionRead, DecodeError, MapSnapshot } from "./domain/model";
import { validateMap } from "./domain/validate";

export const fail = (message: string) => Effect.fail(new WayfulError({ message }));

/**
 * Folds a collection read's skip-and-collect contract back into the
 * abort-on-first-decode-error effect callers had before this contract
 * existed: fails with the first decode error's message, or succeeds with the
 * records. Commands that haven't been upgraded to render partial results
 * (everything but `map show`, `map status`, and `map next`) use this to keep
 * their existing, unaffected behaviour.
 */
export function strict<T>(read: CollectionRead<T>): Effect.Effect<readonly T[], WayfulError> {
  return read.errors.length
    ? Effect.fail(new WayfulError({ message: read.errors[0]!.message }))
    : Effect.succeed(read.records);
}

function envOption(name: string): Option.Option<string> {
  return Option.fromNullishOr(process.env[name]);
}

export function resolveProject(
  projectFlag: Option.Option<string>,
): Effect.Effect<ProjectHandle, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    const hint = Option.orElse(projectFlag, () => envOption("WAYFUL_PROJECT"));
    return yield* backend.openProject(hint);
  });
}

export function resolveMap(
  mapFlag: Option.Option<string>,
  project: ProjectHandle,
): Effect.Effect<MapHandle, WayfulError | MapMetadataError, WayfulBackend> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    const name = Option.orElse(mapFlag, () => envOption("WAYFUL_MAP"));
    if (Option.isNone(name))
      return yield* fail("map context is required; pass --map or set WAYFUL_MAP.");
    const map = yield* backend.openMap(project, name.value);
    if (map.metadata.allowed_step_types !== undefined) {
      const types = yield* backend.listTypes(project);
      const known = new Set(types.records.map((type) => type.name));
      if (map.metadata.allowed_step_types.some((type) => !known.has(type)))
        return yield* Effect.fail(
          new MapMetadataError({
            message: "map allowed_step_types contains an unknown project type.",
          }),
        );
    }
    return map;
  });
}

/**
 * Resolves the map a reference addresses: an explicit map prefix on the
 * reference always wins over `--map`/`WAYFUL_MAP`, since a map-qualified
 * reference is unambiguous about which map it names.
 */
export function resolveReferencedMap(
  refMap: string | undefined,
  mapFlag: Option.Option<string>,
  project: ProjectHandle,
): Effect.Effect<MapHandle, WayfulError | MapMetadataError, WayfulBackend> {
  return refMap !== undefined
    ? resolveMap(Option.some(refMap), project)
    : resolveMap(mapFlag, project);
}

/**
 * Assembles a map's full snapshot from the backend's skip-and-collect reads,
 * alongside every decode error collected across its steps, artifacts,
 * goals, and project types. Reading stays lenient here — the snapshot holds
 * whatever decoded successfully — and it is up to the caller whether the
 * accompanying `errors` block further processing (`assertWritableMapIntegrity`,
 * `map validate`) or are only reported (`map show`, `map status`, `map next`).
 */
export function buildSnapshot(
  map: MapHandle,
): Effect.Effect<
  { snapshot: MapSnapshot; errors: readonly DecodeError[] },
  WayfulError,
  WayfulBackend
> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    const steps = yield* backend.listSteps(map);
    const artifacts = yield* backend.listArtifacts(map);
    const goals = yield* backend.listGoals(map);
    const types = yield* backend.listTypes(map.project);
    return {
      snapshot: {
        map: map.metadata,
        steps: steps.records,
        artifacts: artifacts.records,
        goals: goals.records,
        types: types.records,
      },
      errors: [...steps.errors, ...artifacts.errors, ...goals.errors, ...types.errors],
    };
  });
}

/**
 * The write path's integrity check: any decode error anywhere in the map —
 * not just a `validateMap` semantic error — blocks the write. This is what
 * keeps read-side leniency from letting a write succeed while silently
 * ignoring a record the reader skipped (for instance a new step whose id
 * collides with a broken one).
 */
export function assertWritableMapIntegrity(
  map: MapHandle,
): Effect.Effect<void, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const { snapshot, errors: readErrors } = yield* buildSnapshot(map);
    const validationErrors = validateMap(snapshot, { includeProgress: false });
    const errors = [...readErrors.map((e) => `${e.file}: ${e.message}`), ...validationErrors];
    if (errors.length) yield* fail(`map integrity check failed: ${errors.join(" ")}`);
  });
}
