import { existsSync } from "node:fs";
import { join } from "node:path";

import { atomic, fail, identifier, nonEmpty, yaml } from "../core";

export async function handleArtifact(
  command: string,
  flags: Record<string, any>,
  position: string[],
  m: any,
) {
  if (command !== "add") fail(`unknown artifact command '${command}'.`);
  const name = identifier(position[2] ?? fail("artifact name is required."), "artifact name"),
    kind = nonEmpty(flags.kind, "artifact kind"),
    ref = nonEmpty(flags.ref, "artifact reference");
  const file = join(m.dir, "artifacts", `${name}.yaml`);
  if (existsSync(file) || existsSync(join(m.dir, "artifacts", `${name}.yml`)))
    fail(`artifact '${name}' already exists.`);
  await atomic(file, yaml({ format_version: 1, name, kind, ref }));
  console.log(`Added artifact '${name}'.`);
}
