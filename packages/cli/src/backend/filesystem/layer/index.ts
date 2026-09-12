import { Effect, Fiber, FileSystem, Layer, Path, Stream } from "effect";

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
    readArtifact: makeReadArtifact({ fs, path, snapshot: snapshotOp.snapshot }),
    // Watching is a convenience; the viewer still works without it. The
    // watch stream is run to completion on a detached fiber rather than
    // awaited here, so a directory that cannot be watched (or a watcher that
    // fails mid-stream) is swallowed by `Effect.ignore` instead of failing
    // the backend; the stop function returned below tears the fiber down via
    // `Fiber.interrupt`, which the stream's `acquireRelease` turns into the
    // underlying watcher's close.
    watch: (project, onChange) =>
      fs.watch(path.join(project.root, ".wayful"), { recursive: true }).pipe(
        Stream.runForEach(() => Effect.sync(onChange)),
        Effect.ignore,
        Effect.forkDetach,
        Effect.map((fiber) => () => {
          Effect.runFork(Fiber.interrupt(fiber));
        }),
      ),
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
