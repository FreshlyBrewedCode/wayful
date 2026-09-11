import { Effect, FileSystem, Layer, Path } from "effect";
import { watch, type FSWatcher } from "node:fs";

import { makeReadArtifact } from "../../artifacts";
import { MapStore } from "../../MapStore";
import { ProjectStore } from "../../ProjectStore";
import { makeGoalOps } from "./ops/goal";
import { makeMapOps } from "./ops/map";
import { makeProjectOps } from "./ops/project";
import { makeSnapshotOp } from "./ops/snapshot";
import { makeStepOps } from "./ops/step";
import { makeTypeOps } from "./ops/type";

export const FileSystemProjectStore = Layer.effect(
  ProjectStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return ProjectStore.of({
      ...makeProjectOps(fs, path),
      ...makeTypeOps(fs, path),
    });
  }),
);

/**
 * Builds the filesystem `MapStore` against an already-resolved `FileSystem`
 * and `Path`. Exposed separately from the layer so a backend router can hold
 * this implementation alongside the GitHub one and dispatch per call.
 */
export function makeFileSystemMapStore(fs: FileSystem.FileSystem, path: Path.Path) {
  const mapOps = makeMapOps(fs, path);
  const stepOps = makeStepOps(fs, path);
  const goalOps = makeGoalOps(fs, path);
  const typeOps = makeTypeOps(fs, path);
  const snapshotOp = makeSnapshotOp({
    listSteps: stepOps.listSteps,
    listGoals: goalOps.listGoals,
    listTypes: typeOps.listTypes,
  });

  return MapStore.of({
    ...mapOps,
    ...stepOps,
    ...goalOps,
    ...snapshotOp,
    readArtifact: makeReadArtifact({ snapshot: snapshotOp.snapshot }),
    // Watching is a convenience; the viewer still works without it. A watcher
    // that cannot be constructed degrades to a no-op subscription rather than
    // failing the backend.
    watch: (project, onChange) =>
      Effect.sync(() => {
        const wayful = path.join(project.root, ".wayful");
        let watcher: FSWatcher | undefined;
        try {
          watcher = watch(wayful, { recursive: true }, () => onChange());
        } catch {
          watcher = undefined;
        }
        return () => watcher?.close();
      }),
  });
}

export const FileSystemMapStore = Layer.effect(
  MapStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return makeFileSystemMapStore(fs, path);
  }),
);

export const FileSystemBackend = Layer.mergeAll(FileSystemProjectStore, FileSystemMapStore);
