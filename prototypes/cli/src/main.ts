#!/usr/bin/env bun
import { run } from "./commands";

run().catch((error) => {
  console.error(
    `wayful: ${error instanceof Error ? error.message : "unexpected error."}`,
  );
  process.exitCode = 2;
});
