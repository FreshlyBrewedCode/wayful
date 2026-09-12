import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";

import { FileSystemMapStore } from "@backend/filesystem/layer";
import { describeMapStoreContract } from "@test/support/map-store-contract";

describeMapStoreContract(
  "FileSystemBackend",
  FileSystemMapStore.pipe(Layer.provide(BunServices.layer)),
);
