import { existsSync } from "node:fs";
import { join } from "node:path";

import { fail, identifier, nonEmpty, writeMd } from "../core";
import { artifacts, bodyLines, goals, render } from "../model";

export async function handleGoal(command: string, flags: Record<string, any>, m: any) {
  if (command === "list") {
    const gs = await goals(m);
    render(
      gs.map(({ path, ...g }) => g),
      flags,
      gs.flatMap((g) => [`${g.name}: ${g.description}`, ...bodyLines(g.body)]).join("\n"),
    );
    return;
  }
  if (command === "add") {
    const name = identifier(flags.name, "goal name"),
      description = nonEmpty(flags.description, "goal description"),
      file = join(m.dir, "goals", `${name}.md`);
    if (existsSync(file)) fail(`goal '${name}' already exists.`);
    await writeMd(
      file,
      {
        format_version: 1,
        name,
        description,
        evidence: [],
      },
      flags.body ?? "",
    );
    console.log(`Added goal '${name}'.`);
    return;
  }
  if (command === "satisfy") {
    const name = identifier(flags.goal, "goal name"),
      gs = await goals(m),
      g = gs.find((x) => x.name === name);
    if (!g) fail(`goal '${name}' does not exist.`);
    if (g.evidence.length) fail(`goal '${name}' is already satisfied.`);
    const rawEvidence = flags.artifact ?? flags.evidence;
    const evidence = Array.isArray(rawEvidence) ? rawEvidence : rawEvidence ? [rawEvidence] : [];
    if (!evidence.length) fail("at least one evidence artifact is required.");
    const arts = await artifacts(m);
    evidence.forEach((x) => {
      identifier(x, "artifact name");
      if (!arts.some((a) => a.name === x)) fail(`artifact '${x}' does not exist.`);
    });
    g.evidence = evidence;
    const { path, body, ...data } = g;
    await writeMd(path, data, body);
    console.log(`Satisfied goal '${name}'.`);
    return;
  }
  fail(`unknown goal command '${command}'.`);
}
