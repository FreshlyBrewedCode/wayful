import { Effect, Option } from "effect";

import { WayfulBackend, type MapHandle, type ProjectHandle } from "../backend/Backend";
import { MapMetadataError, WayfulError } from "../domain/errors";
import type { MapSnapshot } from "../domain/model";
import { validateMap } from "../domain/validate";

export const fail = (message: string) => Effect.fail(new WayfulError({ message }));

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
      const known = new Set(types.map((type) => type.name));
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

export function buildSnapshot(
  map: MapHandle,
): Effect.Effect<MapSnapshot, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const backend = yield* WayfulBackend;
    const steps = yield* backend.listSteps(map);
    const artifacts = yield* backend.listArtifacts(map);
    const goals = yield* backend.listGoals(map);
    const types = yield* backend.listTypes(map.project);
    return { map: map.metadata, steps, artifacts, goals, types };
  });
}

export function assertWritableMapIntegrity(
  map: MapHandle,
): Effect.Effect<void, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const snapshot = yield* buildSnapshot(map);
    const errors = validateMap(snapshot, { includeProgress: false });
    if (errors.length) yield* fail(`map integrity check failed: ${errors.join(" ")}`);
  });
}
