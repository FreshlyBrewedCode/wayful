import { Effect, FileSystem, Layer, Path } from "effect";

import type { ProjectBackend } from "../domain/model";
import { FileSystemProjectStore, makeFileSystemMapStore } from "./filesystem/layer";
import { makeGithubMapStore } from "./github/mapStore";
import { MapStore } from "./MapStore";

/**
 * A `MapStore` that dispatches on the project's configured backend. Both
 * implementations are built once, at layer construction; the backend is a
 * property of the project (`project.toml`), not of the invocation, so it can
 * only be chosen after `openProject` has read it.
 */
export const RoutedMapStore = Layer.effect(
  MapStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const local = makeFileSystemMapStore(fs, path);
    const github = yield* makeGithubMapStore();

    const storeFor = (backend: ProjectBackend) => (backend === "github" ? github : local);

    return MapStore.of({
      listMaps: (project) => storeFor(project.backend).listMaps(project),
      createMap: (project, options) => storeFor(project.backend).createMap(project, options),
      openMap: (project, name) => storeFor(project.backend).openMap(project, name),
      listSteps: (map) => storeFor(map.project.backend).listSteps(map),
      createStep: (map, step) => storeFor(map.project.backend).createStep(map, step),
      saveStep: (map, step) => storeFor(map.project.backend).saveStep(map, step),
      listGoals: (map) => storeFor(map.project.backend).listGoals(map),
      createGoal: (map, goal) => storeFor(map.project.backend).createGoal(map, goal),
      saveGoal: (map, goal) => storeFor(map.project.backend).saveGoal(map, goal),
      snapshot: (map) => storeFor(map.project.backend).snapshot(map),
    });
  }),
);

/**
 * The composed backend: `ProjectStore` is always filesystem — configuration
 * and types belong on disk and in version control — while `MapStore` routes.
 */
export const Backend = RoutedMapStore.pipe(Layer.provideMerge(FileSystemProjectStore));
