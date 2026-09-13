import { Effect, Option } from "effect";

import type { MapHandle } from "@backend/MapStore";
import { MapStore } from "@backend/MapStore";
import type { ProjectHandle } from "@backend/ProjectStore";
import { ProjectStore } from "@backend/ProjectStore";
import { MapMetadataError, WayfulError } from "@domain/errors";
import type { CollectionRead, DecodeError, MapSnapshot } from "@domain/model";
import { validateMap } from "@domain/validate";

export const fail = (message: string) => Effect.fail(new WayfulError({ message }));

/**
 * Folds a collection read's skip-and-collect contract back into an
 * abort-on-first-decode-error effect for callers that cannot render partial
 * results: fails naming the record that failed (`#4` or `2-bad.md`), or
 * succeeds with the records.
 */
export function strict<T>(read: CollectionRead<T>): Effect.Effect<readonly T[], WayfulError> {
  return read.errors.length
    ? Effect.fail(
        new WayfulError({
          message: `${read.errors[0]!.file}: ${read.errors[0]!.message}`,
        }),
      )
    : Effect.succeed(read.records);
}

// TODO(#75): read this through Effect `Config` rather than `process.env`. The fix
// is on hold because it adds a `Config` requirement to `resolveProject`/
// `resolveMap` and ripples through their ~15 command/server callers.
function envOption(name: string): Option.Option<string> {
  return Option.fromNullishOr(process.env[name]);
}

export function resolveProject(
  projectFlag: Option.Option<string>,
): Effect.Effect<ProjectHandle, WayfulError, ProjectStore> {
  return Effect.gen(function* () {
    const projectStore = yield* ProjectStore;
    const hint = Option.orElse(projectFlag, () => envOption("WAYFUL_PROJECT"));
    return yield* projectStore.openProject(hint);
  });
}

export function resolveMap(
  mapFlag: Option.Option<string>,
  project: ProjectHandle,
): Effect.Effect<MapHandle, WayfulError | MapMetadataError, MapStore | ProjectStore> {
  return Effect.gen(function* () {
    const mapStore = yield* MapStore;
    const projectStore = yield* ProjectStore;
    const name = Option.orElse(mapFlag, () => envOption("WAYFUL_MAP"));
    if (Option.isNone(name))
      return yield* fail("map context is required; pass --map or set WAYFUL_MAP.");
    const map = yield* mapStore.openMap(project, name.value);
    if (map.metadata.allowed_step_types !== undefined) {
      const types = yield* projectStore.listTypes(project);
      const known = new Set(types.records.map((type) => type.name));
      if (map.metadata.allowed_step_types.some((type) => !known.has(type)))
        return yield* new MapMetadataError({
          message: "map allowed_step_types contains an unknown project type.",
        });
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
): Effect.Effect<MapHandle, WayfulError | MapMetadataError, MapStore | ProjectStore> {
  return refMap !== undefined
    ? resolveMap(Option.some(refMap), project)
    : resolveMap(mapFlag, project);
}

/**
 * Assembles a map's full snapshot in one backend round trip, alongside every
 * decode error collected across its steps, goals, and project types.
 * Artifacts carry no record of their own (ADR-0004) and are derived from the
 * steps' and goals' attachments once those decode. Reading stays lenient
 * here — the snapshot holds whatever decoded successfully — and it is up to
 * the caller whether the accompanying `errors` block further processing
 * (`assertWritableMapIntegrity`, `map validate`) or are only reported
 * (`map show`, `map status`, `map next`).
 */
export function buildSnapshot(
  map: MapHandle,
): Effect.Effect<{ snapshot: MapSnapshot; errors: readonly DecodeError[] }, WayfulError, MapStore> {
  return Effect.gen(function* () {
    const mapStore = yield* MapStore;
    return yield* mapStore.snapshot(map);
  });
}

/**
 * The write path's integrity gate, scoped to the records a command actually
 * touches. Whole-map `validateMap` semantics still gate every write — a
 * duplicate identity anywhere invalidates the map, the same as before — but
 * *decode* errors are taken from the collection the command read and is about
 * to mutate, not from every record in the map. A malformed goal therefore
 * never blocks a step write, nor a malformed step a goal write.
 *
 * The failed record is named by its own `file`, so a decode error surfaced
 * through this hard failure says which record produced it.
 */
export function assertWritableMapIntegrity<T>(
  map: MapHandle,
  read: CollectionRead<T>,
): Effect.Effect<void, WayfulError, MapStore> {
  return Effect.gen(function* () {
    const { snapshot } = yield* buildSnapshot(map);
    const validationErrors = validateMap(snapshot, { includeProgress: false });
    const errors = [...read.errors.map((e) => `${e.file}: ${e.message}`), ...validationErrors];
    if (errors.length) return yield* fail(`map integrity check failed: ${errors.join(" ")}`);
  });
}
