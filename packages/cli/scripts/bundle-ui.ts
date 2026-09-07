#!/usr/bin/env bun
// Builds the viewer client and copies it into this package, so `wayful ui`
// serves a client the CLI owns rather than one it hopes is in a sibling
// directory. `src/server/client.ts` looks here first.

import { cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const UI_ROOT = resolve(PACKAGE_ROOT, "..", "ui");
const SOURCE = join(UI_ROOT, "dist");
const TARGET = join(PACKAGE_ROOT, "dist", "ui");

const build = Bun.spawnSync({
  cmd: ["bun", "run", "build"],
  cwd: UI_ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) {
  console.error("wayful: viewer client build failed.");
  process.exit(build.exitCode);
}

if (!(await Bun.file(join(SOURCE, "index.html")).exists())) {
  console.error(`wayful: ${SOURCE} has no index.html after building.`);
  process.exit(1);
}

// Replaced rather than merged: a stale hashed asset left behind would be served
// forever, since nothing else ever deletes from this directory.
await rm(TARGET, { force: true, recursive: true });
await cp(SOURCE, TARGET, { recursive: true });

console.log(`wayful: bundled the viewer client into ${TARGET}`);
