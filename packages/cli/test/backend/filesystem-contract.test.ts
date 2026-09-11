import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";

import { FileSystemMapStore } from "../../src/backend/filesystem/layer";
import { describeMapStoreContract } from "./support/map-store-contract";

describeMapStoreContract(
  "FileSystemBackend",
  FileSystemMapStore.pipe(Layer.provide(BunServices.layer)),
);
