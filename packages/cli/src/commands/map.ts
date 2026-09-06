import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { atomic, fail, identifier, nonEmpty, toml, writeMd } from "../core";
import {
  allMaps,
  allSteps,
  artifacts,
  attachmentOK,
  bodyLines,
  dependenciesOK,
  goals,
  project,
  render,
  validate,
} from "../model";

export async function handleMapCreate(flags: Record<string, any>) {
  const p = await project(flags);
  const name = identifier(flags.map, "map name");
  const start = nonEmpty(flags.start, "map start");
  const goal = nonEmpty(flags.goal, "map goal");
  const dir = join(p.root, ".wayful", "maps", name);

  if (existsSync(dir)) fail(`map '${name}' already exists.`);
  await mkdir(join(dir, "steps"), { recursive: true });
  await mkdir(join(dir, "artifacts"));
  await mkdir(join(dir, "goals"));
  await atomic(join(dir, "map.toml"), toml({ format_version: 1, name, start, step_id_counter: 1 }));
  await writeMd(
    join(dir, "goals", "initial-goal.md"),
    {
      format_version: 1,
      name: "initial-goal",
      description: goal,
      evidence: [],
    },
    flags["goal-body"] ?? "",
  );
  console.log(`Created map '${name}'.`);
}

export async function handleMapList(flags: Record<string, any>) {
  const maps = await allMaps(flags);
  render(maps, flags, maps.map((map) => `${map.name}: ${map.start}`).join("\n"));
}

export async function handleMap(command: string, flags: Record<string, any>, m: any) {
  if (command === "validate") {
    const errors = await validate(m);
    const value = { valid: errors.length === 0, errors };
    if (flags.json) console.log(JSON.stringify(value, null, 2));
    else if (errors.length) console.error(`wayful: invalid map: ${errors.join(" ")}`);
    else console.log("Map is valid.");
    if (errors.length) process.exitCode = 1;
    return;
  }
  const ss = await allSteps(m),
    arts = await artifacts(m),
    gs = await goals(m);
  if (command === "show") {
    const v = {
      ...m.data,
      goals: gs.map(({ path, ...g }) => g),
      artifacts: arts,
      steps: ss.map(({ path, ...s }) => s),
    };
    const human = [
      `Map ${m.name}`,
      `Start: ${m.data.start}`,
      "Goals:",
      ...(gs.length
        ? gs.flatMap((g) => [`- ${g.name}: ${g.description}`, ...bodyLines(g.body, "  ")])
        : ["- none"]),
      "Artifacts:",
      ...(arts.length
        ? arts.map((artifact) => `- ${artifact.name} (${artifact.kind}): ${artifact.ref}`)
        : ["- none"]),
      "Steps:",
      ...(ss.length
        ? ss.flatMap((step) => [
            `- ${step.id} ${step.name}: ${step.description}`,
            ...bodyLines(step.body, "  "),
          ])
        : ["- none"]),
    ].join("\n");
    render(v, flags, human);
    return;
  }
  if (command === "next") {
    const v = ss.filter(
      (s) => s.status === "pending" && dependenciesOK(s, ss) && attachmentOK(s, "inputs", arts),
    );
    render(
      v.map(({ path, body, ...s }) => s),
      flags,
      v.map((s) => `${s.id} ${s.name}: ${s.description}`).join("\n"),
    );
    return;
  }
  if (command === "status") {
    const next = ss.filter(
      (s) => s.status === "pending" && dependenciesOK(s, ss) && attachmentOK(s, "inputs", arts),
    );
    const counts = Object.fromEntries(
      ["pending", "blocked", "complete", "cancelled"].map((k) => [
        k,
        ss.filter((s) => s.status === k).length,
      ]),
    );
    const blockers = ss
      .filter((s) => s.status === "blocked")
      .map((s) => ({ id: s.id, name: s.name, reason: s.block_reason }));
    const v = {
      map: m.name,
      goals: {
        satisfied: gs.filter((g) => g.evidence.length).length,
        total: gs.length,
      },
      steps: counts,
      blockers,
      next: next.map((s) => ({ id: s.id, name: s.name })),
    };
    const human = [
      `Map ${m.name}`,
      `Goals: ${v.goals.satisfied}/${v.goals.total} satisfied`,
      `Steps: ${counts.pending} pending, ${counts.blocked} blocked, ${counts.complete} complete, ${counts.cancelled} cancelled`,
      "Blockers:",
      ...(blockers.length
        ? blockers.map((s) => `- ${s.id} ${s.name}: ${s.reason ?? "no reason recorded"}`)
        : ["- none"]),
      "Actionable steps:",
      ...(next.length ? next.map((s) => `- ${s.id} ${s.name}: ${s.description}`) : ["- none"]),
    ].join("\n");
    render(v, flags, human);
    return;
  }
  fail(`unknown map command '${command}'.`);
}
