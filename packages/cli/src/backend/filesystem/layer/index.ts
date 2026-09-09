import { Effect, FileSystem, Layer, Path } from "effect";

import { WayfulBackend } from "../../Backend";
import { makeArtifactOps } from "./ops/artifact";
import { makeGoalOps } from "./ops/goal";
import { makeMapOps } from "./ops/map";
import { makeProjectOps } from "./ops/project";
import { makeStepOps } from "./ops/step";
import { makeTypeOps } from "./ops/type";

export const FileSystemBackend = Layer.effect(
  WayfulBackend,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return WayfulBackend.of({
      ...makeProjectOps(fs, path),
      ...makeTypeOps(fs, path),
      ...makeMapOps(fs, path),
      ...makeStepOps(fs, path),
      ...makeArtifactOps(fs, path),
      ...makeGoalOps(fs, path),
    });
  }),
);
