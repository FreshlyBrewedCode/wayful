import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  CliError,
  Dict,
  IDENT,
  MapMetadataError,
  fail,
  frontmatter,
  identifier,
  nonEmpty,
  parseToml,
  parseYaml,
  projectMetadata,
  slots,
  version,
  writeMd,
} from "./core";

async function discover(start: string) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".wayful", "project.toml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fail("no Wayful project found; run 'wayful init' first.");
}
async function project(flags: Dict) {
  const root = await discover(
    flags.project ?? process.env.WAYFUL_PROJECT ?? process.cwd(),
  );
  const file = join(root, ".wayful", "project.toml");
  const data = parseToml(await readFile(file, "utf8"), file);
  projectMetadata(data);
  return { root, data };
}
async function mapContext(flags: Dict) {
  const p = await project(flags);
  const name = identifier(
    flags.map ??
      process.env.WAYFUL_MAP ??
      fail("map context is required; pass --map or set WAYFUL_MAP."),
    "map name",
  );
  const dir = join(p.root, ".wayful", "maps", name);
  const file = join(dir, "map.toml");
  if (!existsSync(file)) fail(`map '${name}' does not exist.`);
  try {
    const data = parseToml(await readFile(file, "utf8"), file);
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail("malformed map metadata.");
    const allowed = new Set([
      "format_version",
      "name",
      "start",
      "step_id_counter",
      "allowed_step_types",
    ]);
    if (Object.keys(data).some((key) => !allowed.has(key)))
      fail("malformed map metadata.");
    version(data, "map metadata", true);
    if (
      data.name !== name ||
      !nonEmpty(data.start, "map start") ||
      !Number.isInteger(data.step_id_counter) ||
      data.step_id_counter < 1
    )
      fail("malformed map metadata.");
    if (data.allowed_step_types !== undefined) {
      if (
        !Array.isArray(data.allowed_step_types) ||
        data.allowed_step_types.some(
          (x: any) => typeof x !== "string" || !IDENT.test(x),
        ) ||
        new Set(data.allowed_step_types).size !== data.allowed_step_types.length
      )
        fail("malformed map metadata.");
      const known = new Set((await allTypes(p.root)).map((type) => type.name));
      if (data.allowed_step_types.some((type: string) => !known.has(type)))
        fail("map allowed_step_types contains an unknown project type.");
    }
    return { ...p, name, dir, data };
  } catch (error) {
    if (error instanceof CliError) throw new MapMetadataError(error.message);
    throw error;
  }
}
async function allMaps(flags: Dict) {
  const p = await project(flags);
  const dir = join(p.root, ".wayful", "maps");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    fail("cannot read project maps.");
  }
  const maps = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map(async (name) => {
        try {
          return (await mapContext({ project: p.root, map: name })).data;
        } catch {
          return undefined;
        }
      }),
  );
  return maps.filter((map): map is Dict => map !== undefined);
}
async function typeDef(root: string, name: string) {
  identifier(name, "type name");
  const file = join(root, ".wayful", "types", `${name}.md`);
  if (!existsSync(file)) fail(`type '${name}' does not exist.`);
  const { data, body } = await frontmatter(file);
  version(data, `type '${name}'`);
  if (data.name !== name)
    fail(`type filename and name do not match for '${name}'.`);
  return {
    ...data,
    name: identifier(data.name, "type name"),
    description: nonEmpty(data.description, "type description"),
    required_inputs: slots(data.required_inputs ?? [], "required_inputs"),
    required_outputs: slots(data.required_outputs ?? [], "required_outputs"),
    instructions: body,
  };
}
async function allTypes(root: string) {
  const dir = join(root, ".wayful", "types");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    fail("cannot read project types.");
  }
  return Promise.all(
    files
      .filter((x) => x.endsWith(".md"))
      .sort()
      .map((x) => typeDef(root, x.slice(0, -3))),
  );
}
async function allSteps(m: any) {
  const dir = join(m.dir, "steps");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    fail("cannot read steps.");
  }
  const result = [];
  for (const file of files.filter((x) => x.endsWith(".md")).sort()) {
    const path = join(dir, file);
    const { data, body } = await frontmatter(path);
    try {
      validateStep(data);
    } catch (e) {
      if (e instanceof CliError) fail(`${e.message} (${file})`);
      throw e;
    }
    if (basename(file) !== `${data.id}-${data.name}.md`)
      fail(`step filename does not match identity (${file}).`);
    result.push({ ...data, body, path });
  }
  return result.sort((a, b) => a.id - b.id);
}
function validateStep(s: Dict) {
  version(s, "step");
  if (!Number.isInteger(s.id) || s.id < 1) fail("invalid step ID.");
  identifier(s.name, "step name", true);
  identifier(s.type, "step type");
  nonEmpty(s.description, "step description");
  if (!["pending", "blocked", "complete", "cancelled"].includes(s.status))
    fail("invalid step status.");
  if (
    !Array.isArray(s.dependencies) ||
    s.dependencies.some((x) => !Number.isInteger(x))
  )
    fail("invalid step dependencies.");
  if (!Array.isArray(s.inputs) || !Array.isArray(s.outputs))
    fail("invalid step attachments.");
  slots(s.required_inputs, "required_inputs");
  slots(s.required_outputs, "required_outputs");
  if (s.status === "complete")
    nonEmpty(s.completion_summary, "completion summary");
  if (s.status === "cancelled")
    nonEmpty(s.cancellation_reason, "cancellation reason");
  if (s.status === "blocked") nonEmpty(s.block_reason, "block reason");
}
async function step(m: any, reference: string) {
  const ss = await allSteps(m);
  const found = /^\d+$/.test(reference)
    ? ss.find((s) => s.id === Number(reference))
    : ss.find((s) => s.name === reference);
  if (!found) fail(`step '${reference}' does not exist.`);
  return found;
}
async function saveStep(s: any) {
  const { path, body, ...data } = s;
  await writeMd(path, data, body);
}
async function artifacts(m: any) {
  const dir = join(m.dir, "artifacts");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    fail("cannot read artifacts.");
  }
  const out: any[] = [];
  for (const f of files.filter((x) => /\.ya?ml$/.test(x))) {
    const data = parseYaml(await readFile(join(dir, f), "utf8"), f);
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail(`malformed artifact '${f}'.`);
    version(data, `artifact '${f}'`);
    identifier(data.name, "artifact name");
    nonEmpty(data.kind, "artifact kind");
    nonEmpty(data.ref, "artifact reference");
    if (f.replace(/\.ya?ml$/, "") !== data.name)
      fail(`artifact filename does not match identity (${f}).`);
    out.push(data);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
async function goals(m: any) {
  const dir = join(m.dir, "goals");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    fail("cannot read goals.");
  }
  const out: any[] = [];
  for (const f of files.filter((x) => x.endsWith(".md"))) {
    const { data, body } = await frontmatter(join(dir, f));
    version(data, `goal '${f}'`);
    identifier(data.name, "goal name");
    nonEmpty(data.description, "goal description");
    if (
      !Array.isArray(data.evidence) ||
      data.evidence.some((x: any) => typeof x !== "string")
    )
      fail(`invalid goal evidence (${f}).`);
    if (f !== `${data.name}.md`)
      fail(`goal filename does not match identity (${f}).`);
    out.push({ ...data, body, path: join(dir, f) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function render(value: any, flags: Dict, human: string) {
  console.log(flags.json ? JSON.stringify(value, null, 2) : human);
}
function attachmentOK(s: any, direction: "inputs" | "outputs", arts: any[]) {
  const required =
    s[direction === "inputs" ? "required_inputs" : "required_outputs"];
  const attachments = Array.isArray(s[direction]) ? s[direction] : [];
  return (
    Array.isArray(required) &&
    required.every((slot: any) => {
      const a = attachments.find(
        (x: any) =>
          x &&
          typeof x === "object" &&
          !Array.isArray(x) &&
          x.slot === slot.name,
      );
      return (
        a && arts.some((x) => x.name === a.artifact && x.kind === slot.kind)
      );
    })
  );
}
function attachmentErrors(
  s: any,
  direction: "inputs" | "outputs",
  arts: any[],
) {
  const errors: string[] = [];
  const attachments = s[direction];
  const required =
    s[direction === "inputs" ? "required_inputs" : "required_outputs"] ?? [];
  const slotsSeen = new Set<string>();
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      Array.isArray(attachment) ||
      typeof attachment.artifact !== "string"
    ) {
      errors.push(`step '${s.name}' has an invalid ${direction} attachment.`);
      continue;
    }
    const artifact = arts.find((a) => a.name === attachment.artifact);
    if (!artifact)
      errors.push(
        `step '${s.name}' has a missing ${direction} artifact '${attachment.artifact}'.`,
      );
    if (attachment.slot === undefined) continue;
    if (typeof attachment.slot !== "string") {
      errors.push(
        `step '${s.name}' has an invalid ${direction} slot attachment.`,
      );
      continue;
    }
    const slot = required.find(
      (candidate: any) => candidate.name === attachment.slot,
    );
    if (!slot) {
      errors.push(
        `step '${s.name}' has an unknown ${direction} slot '${attachment.slot}'.`,
      );
      continue;
    }
    if (slotsSeen.has(attachment.slot))
      errors.push(
        `step '${s.name}' fulfills ${direction} slot '${attachment.slot}' more than once.`,
      );
    slotsSeen.add(attachment.slot);
    if (artifact && artifact.kind !== slot.kind)
      errors.push(
        `step '${s.name}' attaches wrong artifact kind to ${direction} slot '${attachment.slot}'.`,
      );
  }
  return errors;
}
function dependenciesOK(s: any, ss: any[]) {
  return s.dependencies.every(
    (id: number) => ss.find((x) => x.id === id)?.status === "complete",
  );
}
async function validate(m: any, includeProgress = true) {
  const errors: string[] = [];
  let ss: any[] = [],
    arts: any[] = [],
    gs: any[] = [];
  try {
    ss = await allSteps(m);
    arts = await artifacts(m);
    gs = await goals(m);
    await allTypes(m.root);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "malformed map state.");
    return errors;
  }
  const highestStepID = ss.reduce((highest, s) => Math.max(highest, s.id), 0);
  if (m.data.step_id_counter <= highestStepID)
    errors.push(
      "map step_id_counter must be greater than every existing step ID.",
    );
  const artifactNames = new Set<string>();
  for (const art of arts) {
    if (artifactNames.has(art.name))
      errors.push("duplicate artifact identity.");
    artifactNames.add(art.name);
  }
  const names = new Set<string>(),
    ids = new Set<number>();
  for (const s of ss) {
    if (names.has(s.name) || ids.has(s.id))
      errors.push("duplicate step identity.");
    names.add(s.name);
    ids.add(s.id);
    try {
      const t = await typeDef(m.root, s.type);
      if (
        m.data.allowed_step_types &&
        !m.data.allowed_step_types.includes(s.type)
      )
        errors.push(`step '${s.name}' has a disallowed type.`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "invalid type.");
    }
    const dependencyIDs = new Set<number>();
    for (const id of s.dependencies) {
      if (dependencyIDs.has(id))
        errors.push(`step '${s.name}' has a duplicate dependency.`);
      dependencyIDs.add(id);
      const dep = ss.find((x) => x.id === id);
      if (!dep) errors.push(`step '${s.name}' has a missing dependency.`);
      else if (dep.status === "cancelled")
        errors.push(
          `step '${s.name}' depends on cancelled step '${dep.name}'.`,
        );
    }
    for (const direction of ["inputs", "outputs"] as const)
      errors.push(...attachmentErrors(s, direction, arts));
    if (includeProgress && !attachmentOK(s, "inputs", arts))
      errors.push(`step '${s.name}' has unmet required inputs.`);
    if (s.status === "complete" && !attachmentOK(s, "outputs", arts))
      errors.push(`completed step '${s.name}' has unmet required outputs.`);
    if (includeProgress && s.status === "blocked")
      errors.push(`step '${s.name}' is blocked.`);
    if (includeProgress && s.status === "pending")
      errors.push(`step '${s.name}' remains pending.`);
  }
  const visit = (s: any, seen: Set<number>, stack: Set<number>) => {
    if (stack.has(s.id)) {
      errors.push("dependency cycle detected.");
      return;
    }
    if (seen.has(s.id)) return;
    seen.add(s.id);
    stack.add(s.id);
    s.dependencies.forEach((id: number) => {
      const d = ss.find((x) => x.id === id);
      if (d) visit(d, seen, stack);
    });
    stack.delete(s.id);
  };
  ss.forEach((s) => visit(s, new Set(), new Set()));
  for (const g of gs) {
    if (includeProgress && !g.evidence.length)
      errors.push(`goal '${g.name}' is not satisfied.`);
    for (const evidence of g.evidence)
      if (!arts.some((a) => a.name === evidence))
        errors.push(`goal '${g.name}' has missing evidence.`);
  }
  return [...new Set(errors)];
}
async function assertWritableMapIntegrity(m: any) {
  const errors = await validate(m, false);
  if (errors.length) fail(`map integrity check failed: ${errors.join(" ")}`);
}

export {
  allMaps,
  allSteps,
  allTypes,
  artifacts,
  assertWritableMapIntegrity,
  attachmentErrors,
  attachmentOK,
  dependenciesOK,
  discover,
  goals,
  mapContext,
  project,
  render,
  saveStep,
  step,
  typeDef,
  validate,
};
