import { Effect, FileSystem, Layer, Path } from "effect";

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

export const FileSystemMapStore = Layer.effect(
  MapStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const mapOps = makeMapOps(fs, path);
    const stepOps = makeStepOps(fs, path);
    const goalOps = makeGoalOps(fs, path);
    const typeOps = makeTypeOps(fs, path);

    return MapStore.of({
      ...mapOps,
      ...stepOps,
      ...goalOps,
      ...makeSnapshotOp({
        listSteps: stepOps.listSteps,
        listGoals: goalOps.listGoals,
        listTypes: typeOps.listTypes,
      }),
    });
  }),
);

export const FileSystemBackend = Layer.mergeAll(FileSystemProjectStore, FileSystemMapStore);
