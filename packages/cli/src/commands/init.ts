import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { atomic, fail, nonEmpty, toml, writeMd } from "../core";

export async function handleInit(flags: Record<string, any>) {
  const root = resolve(flags.project ?? process.cwd());
  if (existsSync(join(root, ".wayful")))
    fail("Wayful state already exists; refusing to overwrite it.");
  const description =
    flags.description === undefined ? "" : nonEmpty(flags.description, "project description");
  await mkdir(join(root, ".wayful", "types"), { recursive: true });
  await atomic(join(root, ".wayful", "project.toml"), toml({ format_version: 1, description }));
  await writeMd(join(root, ".wayful", "types", "task.md"), {
    format_version: 1,
    name: "task",
    description: "A general-purpose work step.",
    required_inputs: [],
    required_outputs: [],
  });
  console.log("Initialized Wayful project.");
}
