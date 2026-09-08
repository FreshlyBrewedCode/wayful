import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../src/domain/model";

const cliRoot = join(import.meta.dir, "..");
const entrypoint = join(cliRoot, "src", "main.ts");
const decoder = new TextDecoder();
const temporaryDirectories: string[] = [];
const spawned: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const process of spawned.splice(0)) process.kill();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(prefix = "wayful-cli-") {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function invoke(args: string[], cwd: string, environment: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, entrypoint, ...args],
    cwd,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: decoder.decode(result.stderr),
    stdout: decoder.decode(result.stdout),
  };
}

/**
 * Starts a long-running server command and waits for the banner, which is the
 * only place the actually-bound port and resolved project root are reported —
 * `--port 0` is what keeps concurrent tests off a fixed port.
 */
async function serveInBackground(
  args: string[],
  cwd: string,
  environment: Record<string, string> = {},
) {
  const child = Bun.spawn({
    cmd: [process.execPath, entrypoint, ...args],
    cwd,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  spawned.push(child);
  const reader = child.stdout.getReader();
  let banner = "";
  while (!/local\s+: http:\/\/\S+/.test(banner)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`server exited before serving:\n${banner}`);
    banner += decoder.decode(value);
  }
  reader.releaseLock();
  return { banner, url: banner.match(/local\s+: (http:\/\/\S+)/)![1]! };
}

const fetchJson = (url: string, path: string): Promise<any> =>
  fetch(new URL(path, url)).then((response) => response.json());

function expectCommandError(result: ReturnType<typeof invoke>) {
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toMatch(/^wayful: /);
  expect(result.stderr).not.toContain("Error:");
  // A dispatcher placeholder is neither an actionable command error nor a
  // passing implementation of a rejected-operation contract.
  expect(result.stderr).not.toContain("not been bootstrapped");
}

// A fixed timestamp used only for on-disk fixtures written directly by these
// tests (not produced by the CLI under test), so that fixture files satisfy
// the strict ISO-8601 `created_at`/`updated_at` fields the decoder requires.
const FIXTURE_TIME = "2024-01-01T00:00:00.000Z";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Timestamps are stamped by the backend's injected clock and are not
 * predictable from a spawned CLI subprocess, so equality assertions against
 * CLI JSON output strip them; exact values are covered at the backend seam
 * (test/backend.test.ts), and `expectTimestamps` below spot-checks shape.
 */
function omitTimestamps<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => omitTimestamps(item)) as unknown as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "created_at" || key === "updated_at" || key === "closed_at") continue;
      result[key] = omitTimestamps(v);
    }
    return result as T;
  }
  return value;
}

function expectTimestamps(record: { created_at: string; updated_at: string }) {
  expect(record.created_at).toMatch(ISO_TIMESTAMP);
  expect(record.updated_at).toMatch(ISO_TIMESTAMP);
}

/** Creates documented on-disk input only; it never uses the CLI under test. */
async function projectFixture(
  options: {
    map?: string;
    type?: string;
    typeBody?: string;
    typeSlots?: string;
    mapFields?: string;
  } = {},
) {
  const project = await temporaryDirectory();
  const map = options.map ?? "plan";
  const type = options.type ?? "task";
  await mkdir(join(project, ".wayful", "maps", map, "steps"), { recursive: true });
  await mkdir(join(project, ".wayful", "maps", map, "artifacts"), { recursive: true });
  await mkdir(join(project, ".wayful", "maps", map, "goals"), { recursive: true });
  await mkdir(join(project, ".wayful", "types"), { recursive: true });
  await writeFile(
    join(project, ".wayful", "project.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "Fixture project"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
  );
  await writeFile(
    join(project, ".wayful", "maps", map, "map.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\nname = "${map}"\nstart = "here"\nstep_id_counter = 1\nartifact_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n${options.mapFields ?? ""}`,
  );
  const typeSlots = options.typeSlots ?? "required_inputs: []\nrequired_outputs: []\n";
  await writeFile(
    join(project, ".wayful", "types", `${type}.md`),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: ${type}\ndescription: Fixture type\n${typeSlots}---\n${options.typeBody ?? ""}`,
  );
  return project;
}

async function writeStep(project: string, name: string, id: number, fields = "") {
  const requirements = fields || "required_inputs: []\nrequired_outputs: []\n";
  await writeFile(
    join(project, ".wayful", "maps", "plan", "steps", `${id}-${name}.md`),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: ${id}\nname: ${name}\ntype: task\ndescription: Original description\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\n${requirements}created_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\nNarrative that must survive frontmatter updates.\n`,
  );
  const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
  const metadata = await readFile(mapFile, "utf8");
  const stepIDCounter = Number(metadata.match(/^step_id_counter = (\d+)$/m)?.[1] ?? 1);
  if (stepIDCounter <= id)
    await writeFile(
      mapFile,
      metadata.replace(/^step_id_counter = \d+$/m, `step_id_counter = ${id + 1}`),
    );
}

describe("project and context contracts", () => {
  test("provides root and command-group help plus a root version", async () => {
    const project = await temporaryDirectory();
    for (const args of [["--help"], ["map", "--help"], ["step", "--help"], ["--version"]]) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toBe("");
    }
  });

  test("documents each command's required arguments and available flags in help", async () => {
    const project = await temporaryDirectory();
    const cases: [string[], string][] = [
      [["init", "--help"], "--description TEXT"],
      [["map", "create", "--help"], "--goal TEXT"],
      [["map", "create", "--help"], "--goal-body TEXT"],
      [["map", "list", "--help"], "--project DIR"],
      [["map", "validate", "--help"], "--json"],
      [["map", "show", "--help"], "FLAGS"],
      [["map", "next", "--help"], "--map NAME"],
      [["map", "status", "--help"], "--project DIR"],
      [["step", "create", "--help"], "--required-outputs JSON"],
      [["step", "create", "--help"], "--body TEXT"],
      [["step", "show", "--help"], "STEP"],
      [["step", "update", "--help"], "--description TEXT"],
      [["step", "update", "--help"], "--body TEXT"],
      [["step", "block", "--help"], "--reason TEXT"],
      [["step", "unblock", "--help"], "--map NAME"],
      [["step", "complete", "--help"], "--summary TEXT"],
      [["step", "cancel", "--help"], "--reason TEXT"],
      [["step", "depends", "--help"], "--on STEP"],
      [["step", "input", "--help"], "--slot NAME"],
      [["step", "output", "--help"], "--artifact NAME"],
      [["artifact", "add", "--help"], "--ref REF"],
      [["goal", "list", "--help"], "--json"],
      [["goal", "add", "--help"], "--description TEXT"],
      [["goal", "add", "--help"], "--body TEXT"],
      [["goal", "satisfy", "--help"], "--artifact NAME"],
      [["type", "list", "--help"], "--project DIR"],
      [["type", "show", "--help"], "ARGUMENTS"],
      [["serve", "--help"], "--port PORT"],
      [["serve", "--help"], "--host ADDR"],
      [["serve", "--help"], "--project DIR"],
      [["ui", "--help"], "--port PORT"],
      [["ui", "--help"], "--host ADDR"],
      [["ui", "--help"], "--project DIR"],
    ];
    for (const [args, expected] of cases) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(expected);
      expect(result.stdout).toContain("--help");
    }
  }, 20000); // 33 subprocess spawns; a loaded CI runner can outrun the default 5s.

  test("init creates versioned, timestamped metadata and the generic task type, then refuses overwrite", async () => {
    const project = await temporaryDirectory();
    expect(invoke(["init", "--description", "Refresh the site"], project).exitCode).toBe(0);
    const projectToml = await readFile(join(project, ".wayful", "project.toml"), "utf8");
    expect(projectToml).toContain(`format_version = ${CURRENT_FORMAT_VERSION}`);
    expect(projectToml).toMatch(/created_at = "\d{4}-\d{2}-\d{2}T/);
    expect(projectToml).toMatch(/updated_at = "\d{4}-\d{2}-\d{2}T/);
    expect(await readFile(join(project, ".wayful", "types", "task.md"), "utf8")).toContain(
      "name: task",
    );
    expectCommandError(invoke(["init"], project));
  });

  test("discovers upward, honors WAYFUL_PROJECT, and lets --project override it", async () => {
    const project = await projectFixture();
    const other = await projectFixture({ map: "other" });
    const nested = join(project, "a", "deep", "directory");
    await mkdir(nested, { recursive: true });
    expect(invoke(["map", "show", "--map", "plan", "--json"], nested).exitCode).toBe(0);
    expect(
      invoke(["map", "show", "--map", "other", "--json"], nested, { WAYFUL_PROJECT: other })
        .exitCode,
    ).toBe(0);
    expect(
      invoke(["map", "show", "--project", project, "--map", "plan", "--json"], nested, {
        WAYFUL_PROJECT: other,
      }).exitCode,
    ).toBe(0);
  });

  test("rejects absent, malformed, and newer project metadata plus unsafe identifiers", async () => {
    const absent = await temporaryDirectory();
    expectCommandError(invoke(["map", "show", "--map", "plan"], absent));
    const project = await projectFixture();
    await writeFile(join(project, ".wayful", "project.toml"), "not toml = [");
    expectCommandError(invoke(["type", "list"], project));
    await writeFile(
      join(project, ".wayful", "project.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION + 1}\n`,
    );
    expectCommandError(invoke(["type", "list"], project));
    expectCommandError(
      invoke(["map", "create", "--map", "../unsafe", "--start", "now", "--goal", "done"], project),
    );
  });

  test("strictly validates project metadata while accepting the documented unversioned migration form", async () => {
    const project = await projectFixture();
    const metadata = join(project, ".wayful", "project.toml");
    await writeFile(
      metadata,
      `description = "Legacy project"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    expect(invoke(["type", "list"], project).exitCode).toBe(0);
    for (const invalid of [
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = 42\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nunknown = true\n`,
      `format_version = "${CURRENT_FORMAT_VERSION}"\ndescription = "ok"\n`,
    ]) {
      await writeFile(metadata, invalid);
      expectCommandError(invoke(["type", "list"], project));
    }
  });

  test("requires explicit map context and gives --map precedence over WAYFUL_MAP", async () => {
    const project = await projectFixture();
    await mkdir(join(project, ".wayful", "maps", "other", "steps"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "other", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "other"\nstart = "there"\nstep_id_counter = 1\nartifact_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    const missing = invoke(["map", "show"], project);
    expectCommandError(missing);
    expect(missing.stderr).toBe("wayful: map context is required; pass --map or set WAYFUL_MAP.\n");
    expect(
      invoke(["map", "show", "--map", "plan", "--json"], project, { WAYFUL_MAP: "other" }).exitCode,
    ).toBe(0);
  });

  test("emits a structured {error} on stdout for --json failures, not just map validate", async () => {
    const project = await projectFixture();
    const missingMap = invoke(["map", "show", "--json"], project);
    expect(missingMap.exitCode).toBe(2);
    expect(missingMap.stderr).toBe(
      "wayful: map context is required; pass --map or set WAYFUL_MAP.\n",
    );
    expect(JSON.parse(missingMap.stdout)).toEqual({
      error: "map context is required; pass --map or set WAYFUL_MAP.",
    });

    const missingProject = invoke(["type", "list", "--json"], await temporaryDirectory());
    expect(missingProject.exitCode).toBe(2);
    expect(JSON.parse(missingProject.stdout)).toEqual({
      error: missingProject.stderr.replace(/^wayful: /, "").trimEnd(),
    });

    const unknownMap = invoke(["map", "show", "--map", "missing", "--json"], project);
    expect(unknownMap.exitCode).toBe(2);
    expect(JSON.parse(unknownMap.stdout)).toEqual({
      error: unknownMap.stderr.replace(/^wayful: /, "").trimEnd(),
    });
  });
});

describe("maps, types, and readable rendering", () => {
  test("writes generated YAML collections in multiline block style", async () => {
    const project = await temporaryDirectory();
    expect(invoke(["init"], project).exitCode).toBe(0);
    expect(
      invoke(
        [
          "map",
          "create",
          "--map",
          "plan",
          "--start",
          "here",
          "--goal",
          "done",
          "--goal-body",
          "Completion notes.",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        [
          "artifact",
          "add",
          "proof",
          "--map",
          "plan",
          "--kind",
          "document",
          "--ref",
          "# opaque: value",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        [
          "step",
          "create",
          "work",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Do it",
          "--required-inputs",
          '[{"name":"brief","kind":"document"}]',
        ],
        project,
      ).exitCode,
    ).toBe(0);

    const generated = [
      join(project, ".wayful", "types", "task.md"),
      join(project, ".wayful", "maps", "plan", "goals", "initial-goal.md"),
      join(project, ".wayful", "maps", "plan", "steps", "1-work.md"),
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml"),
    ];
    for (const file of generated) {
      const text = await readFile(file, "utf8");
      expect(text).toContain(`format_version: ${CURRENT_FORMAT_VERSION}\n`);
      expect(text).not.toMatch(/^\{.*\}$/m);
    }
    expect(await readFile(generated[2], "utf8")).toContain(
      "dependencies: \n  []\ninputs: \n  []\noutputs: \n  []\n",
    );
    expect(await readFile(generated[2], "utf8")).toContain(
      "required_inputs: \n  - name: brief\n    kind: document\n",
    );
    expect(await readFile(generated[1], "utf8")).toContain("Completion notes.");
    const shown = JSON.parse(invoke(["map", "show", "--map", "plan", "--json"], project).stdout);
    expect(shown.goals[0].body).toBe("Completion notes.");
    expect(shown.artifacts[0].ref).toBe("# opaque: value");
  });

  test("creates maps with required fields, no overwrite, and deterministic JSON read views", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["map", "create", "--map", "release-plan", "--start", "now", "--goal", "released"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(["map", "create", "--map", "plan", "--start", "now", "--goal", "done"], project),
    );
    const show = invoke(["map", "show", "--map", "plan", "--json"], project);
    expect(show.exitCode).toBe(0);
    expect(() => JSON.parse(show.stdout)).not.toThrow();
    expect(invoke(["map", "status", "--map", "plan", "--json"], project).exitCode).toBe(0);
  });

  test("lists project maps without requiring map context", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["map", "create", "--map", "release-plan", "--start", "now", "--goal", "released"],
        project,
      ).exitCode,
    ).toBe(0);
    const invalidMap = join(project, ".wayful", "maps", "invalid");
    await mkdir(invalidMap);
    await writeFile(join(invalidMap, "map.toml"), "not valid TOML = [");

    const listed = invoke(["map", "list"], project);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toBe("plan: here\nrelease-plan: now\n");

    const listedJson = invoke(["map", "list", "--json"], project);
    const parsed = JSON.parse(listedJson.stdout);
    for (const entry of parsed) expectTimestamps(entry);
    expect(omitTimestamps(parsed)).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "plan",
        start: "here",
        step_id_counter: 1,
        artifact_id_counter: 1,
      },
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "release-plan",
        start: "now",
        step_id_counter: 1,
        artifact_id_counter: 1,
      },
    ]);
  });

  test("reports malformed and unsupported map metadata as invalid map validation", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    await writeFile(mapFile, "not toml = [");
    const malformed = invoke(["map", "validate", "--map", "plan"], project);
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toMatch(/^wayful: invalid map:/);
    expectCommandError(invoke(["map", "show", "--map", "plan"], project));
    const corrupted = `format_version = ${CURRENT_FORMAT_VERSION + 1}\nname = "plan"\nstart = "here"\nstep_id_counter = 1\n`;
    await writeFile(mapFile, corrupted);
    const unsupported = invoke(["map", "validate", "--map", "plan"], project);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain("unsupported format version");
  });

  test("treats an empty or whitespace-only map start as invalid metadata", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    for (const start of ["", "   "]) {
      await writeFile(
        mapFile,
        `format_version = ${CURRENT_FORMAT_VERSION}\nname = "plan"\nstart = "${start}"\nstep_id_counter = 1\n`,
      );
      expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
      expectCommandError(invoke(["map", "show", "--map", "plan"], project));
    }
  });

  test("emits structured, read-only validation results for valid and invalid maps", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    const valid = invoke(["map", "validate", "--map", "plan", "--json"], project);
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout)).toEqual({ valid: true, errors: [] });
    expect(valid.stderr).toBe("");
    const corrupted = `format_version = ${CURRENT_FORMAT_VERSION + 1}\nname = "plan"\nstart = "here"\nstep_id_counter = 1\n`;
    await writeFile(mapFile, corrupted);
    const invalid = invoke(["map", "validate", "--map", "plan", "--json"], project);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout)).toEqual({
      valid: false,
      errors: ["unsupported format version in map metadata."],
    });
    expect(invalid.stderr).toBe("");
    expect(await readFile(mapFile, "utf8")).toBe(corrupted);
  });

  test("parses type names and descriptions from frontmatter and instructions from Markdown bodies", async () => {
    const project = await projectFixture({ type: "research", typeBody: "Use primary sources.\n" });
    const listed = invoke(["type", "list"], project);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toBe("research: Fixture type\n");

    const listedJson = invoke(["type", "list", "--json"], project);
    expect(JSON.parse(listedJson.stdout)).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "research",
        description: "Fixture type",
        required_inputs: [],
        required_outputs: [],
        instructions: "Use primary sources.\n",
      },
    ]);

    const shown = invoke(["type", "show", "research"], project);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toBe("research: Fixture type\nInstructions:\nUse primary sources.\n\n");
  });

  test("requires every type to declare a non-empty frontmatter description", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "types", "task.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: task\nrequired_inputs: []\nrequired_outputs: []\n---\nInstructions.\n`,
    );

    const result = invoke(["type", "list"], project);

    expectCommandError(result);
    expect(result.stderr).toContain("type description is required");
  });

  test("rejects malformed type schema, filename/name mismatch, and disallowed map types", async () => {
    const project = await projectFixture({ mapFields: 'allowed_step_types = ["task"]\n' });
    await writeFile(
      join(project, ".wayful", "types", "wrong.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: other\nrequired_inputs: []\nrequired_outputs: []\n---\n`,
    );
    expectCommandError(invoke(["type", "list"], project));
    await writeFile(
      join(project, ".wayful", "types", "wrong.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: wrong\ndescription: Invalid slot schema\nrequired_inputs: [bad]\nrequired_outputs: []\n---\n`,
    );
    const invalidSlots = invoke(
      ["step", "create", "work", "--map", "plan", "--type", "wrong", "--description", "Do it"],
      project,
    );
    expectCommandError(invalidSlots);
    expect(invalidSlots.stderr).toContain("required_inputs contains an invalid slot");
  });

  test("rejects duplicate or unknown map type restrictions during validation", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    for (const restriction of ['["task", "task"]', '["missing"]']) {
      await writeFile(
        mapFile,
        `format_version = ${CURRENT_FORMAT_VERSION}\nname = "plan"\nstart = "here"\nstep_id_counter = 1\nartifact_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\nallowed_step_types = ${restriction}\n`,
      );
      const validation = invoke(["map", "validate", "--map", "plan"], project);
      expect(validation.exitCode).toBe(1);
      expectCommandError(invoke(["map", "show", "--map", "plan"], project));
    }
  });
});

describe("steps and graph integrity", () => {
  test("creates, updates, preserves, and shows an optional step body", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        [
          "step",
          "create",
          "research",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Research users",
          "--body",
          "Initial notes.\nSecond line.",
        ],
        project,
      ).exitCode,
    ).toBe(0);

    let shown = invoke(["step", "show", "research", "--map", "plan", "--json"], project);
    expect(JSON.parse(shown.stdout).body).toBe("Initial notes.\nSecond line.");
    expect(invoke(["step", "show", "research", "--map", "plan"], project).stdout).toContain(
      "Initial notes.\nSecond line.",
    );

    expect(
      invoke(["step", "update", "research", "--map", "plan", "--body", "Revised notes."], project)
        .exitCode,
    ).toBe(0);
    shown = invoke(["step", "show", "1", "--map", "plan", "--json"], project);
    expect(JSON.parse(shown.stdout).body).toBe("Revised notes.");
    expect(JSON.parse(shown.stdout).description).toBe("Research users");
    expect(
      JSON.parse(invoke(["map", "show", "--map", "plan", "--json"], project).stdout).steps[0].body,
    ).toBe("Revised notes.");
    expect(invoke(["map", "show", "--map", "plan"], project).stdout).toContain("Revised notes.");
    expectCommandError(invoke(["step", "update", "research", "--map", "plan"], project));
  });

  test("creates typed steps with monotonic IDs, persists frontmatter, and resolves name or ID", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        [
          "step",
          "create",
          "research",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Research users",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        [
          "step",
          "create",
          "design",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Design it",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "steps", "1-research.md"), "utf8"),
    ).toContain("id: 1");
    expect(invoke(["step", "show", "1", "--map", "plan", "--json"], project).exitCode).toBe(0);
    expect(invoke(["step", "show", "research", "--map", "plan", "--json"], project).exitCode).toBe(
      0,
    );
  });

  test("versions created steps, stamps timestamps, and rejects missing, malformed, or unsupported step versions", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["step", "create", "work", "--map", "plan", "--type", "task", "--description", "Do it"],
        project,
      ).exitCode,
    ).toBe(0);
    const stepFile = join(project, ".wayful", "maps", "plan", "steps", "1-work.md");
    const stepText = await readFile(stepFile, "utf8");
    expect(stepText).toContain(`format_version: ${CURRENT_FORMAT_VERSION}`);
    expect(stepText).toMatch(/created_at: \d{4}-\d{2}-\d{2}T/);
    expect(stepText).toMatch(/updated_at: \d{4}-\d{2}-\d{2}T/);
    for (const replacement of [
      "",
      "format_version: nope",
      `format_version: ${CURRENT_FORMAT_VERSION + 1}`,
    ]) {
      const original = await readFile(stepFile, "utf8");
      await writeFile(
        stepFile,
        original.replace(`format_version: ${CURRENT_FORMAT_VERSION}`, replacement),
      );
      const validation = invoke(["map", "validate", "--map", "plan"], project);
      expect(validation.exitCode).toBe(1);
      expectCommandError(invoke(["step", "show", "work", "--map", "plan"], project));
      await writeFile(stepFile, original);
    }
  });

  test("snapshots type slots at creation, accepts JSON requirement replacements, and resolves current instructions live", async () => {
    const project = await projectFixture({
      type: "research",
      typeSlots: "required_inputs:\n  - name: source\n    kind: document\nrequired_outputs: []\n",
      typeBody: "Original guidance.\n",
    });
    expect(
      invoke(
        [
          "step",
          "create",
          "investigate",
          "--map",
          "plan",
          "--type",
          "research",
          "--description",
          "Investigate",
          "--required-inputs",
          "[]",
          "--required-outputs",
          '[{"name":"report","kind":"document"}]',
        ],
        project,
      ).exitCode,
    ).toBe(0);
    await writeFile(
      join(project, ".wayful", "types", "research.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: research\ndescription: Updated research contract\nrequired_inputs:\n  - name: changed\n    kind: url\nrequired_outputs: []\n---\nUpdated guidance.\n`,
    );
    const shown = invoke(["step", "show", "investigate", "--map", "plan", "--json"], project);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("report");
    expect(shown.stdout).toContain("Updated guidance.");
  });

  test("updates pending descriptions without losing Markdown body and rejects numeric step names", async () => {
    const project = await projectFixture();
    await writeStep(project, "research", 1);
    expect(
      invoke(["step", "update", "research", "--map", "plan", "--description", "Updated"], project)
        .exitCode,
    ).toBe(0);
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "steps", "1-research.md"), "utf8"),
    ).toContain("Narrative that must survive");
    expectCommandError(
      invoke(
        ["step", "create", "123", "--map", "plan", "--type", "task", "--description", "Invalid"],
        project,
      ),
    );
  });

  test("enforces reasons, allowed transitions, terminal immutability, and completion summaries", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    expectCommandError(invoke(["step", "block", "work", "--map", "plan"], project));
    expect(
      invoke(["step", "block", "work", "--map", "plan", "--reason", "Waiting"], project).exitCode,
    ).toBe(0);
    expect(invoke(["step", "unblock", "work", "--map", "plan"], project).exitCode).toBe(0);
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "steps", "1-work.md"), "utf8"),
    ).not.toContain("block_reason");
    expectCommandError(
      invoke(["step", "complete", "work", "--map", "plan", "--summary", ""], project),
    );
    expect(
      invoke(["step", "cancel", "work", "--map", "plan", "--reason", "Obsolete"], project).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(["step", "update", "work", "--map", "plan", "--description", "Changed"], project),
    );
  });

  test("rejects self, duplicate, cyclic, cancelled, and completed-step dependencies", async () => {
    const project = await projectFixture();
    await writeStep(project, "a", 1);
    await writeStep(project, "b", 2);
    expectCommandError(invoke(["step", "depends", "a", "--map", "plan", "--on", "a"], project));
    expect(invoke(["step", "depends", "a", "--map", "plan", "--on", "b"], project).exitCode).toBe(
      0,
    );
    expectCommandError(invoke(["step", "depends", "a", "--map", "plan", "--on", "b"], project));
    expectCommandError(invoke(["step", "depends", "b", "--map", "plan", "--on", "a"], project));
  });
});

describe("artifacts, goals, and validation", () => {
  test("creates, preserves, and shows optional goal bodies", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        [
          "goal",
          "add",
          "--map",
          "plan",
          "--name",
          "release",
          "--description",
          "Approved",
          "--body",
          "Acceptance details.\nSecond line.",
        ],
        project,
      ).exitCode,
    ).toBe(0);

    const listed = invoke(["goal", "list", "--map", "plan", "--json"], project);
    expect(JSON.parse(listed.stdout)[0].body).toBe("Acceptance details.\nSecond line.");
    expect(invoke(["goal", "list", "--map", "plan"], project).stdout).toContain(
      "Acceptance details.\n  Second line.",
    );

    expect(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:abc"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "proof"],
        project,
      ).exitCode,
    ).toBe(0);
    const map = invoke(["map", "show", "--map", "plan", "--json"], project);
    expect(JSON.parse(map.stdout).goals[0].body).toBe("Acceptance details.\nSecond line.");
    expect(invoke(["map", "show", "--map", "plan"], project).stdout).toContain(
      "Acceptance details.\n    Second line.",
    );
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "goals", "release.md"), "utf8"),
    ).toContain("Acceptance details.\nSecond line.");
  });

  test("registers opaque artifacts once and attaches them by explicit matching slots or supplementarily", async () => {
    const project = await projectFixture({
      typeSlots:
        "required_inputs:\n  - name: brief\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\n",
    });
    await writeStep(
      project,
      "work",
      1,
      "required_inputs:\n  - name: brief\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\n",
    );
    expect(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:abc"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:def"],
        project,
      ),
    );
    expect(
      invoke(
        ["step", "input", "work", "--map", "plan", "--artifact", "proof", "--slot", "brief"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(["step", "output", "work", "--map", "plan", "--artifact", "proof"], project).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["step", "complete", "work", "--map", "plan", "--summary", "Missing required output"],
        project,
      ),
    );
    expect(
      invoke(
        ["step", "output", "work", "--map", "plan", "--artifact", "proof", "--slot", "report"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["step", "complete", "work", "--map", "plan", "--summary", "Evidence recorded"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["step", "input", "work", "--map", "plan", "--artifact", "proof", "--slot", "report"],
        project,
      ),
    );
  });

  test("refuses an artifact name already represented by a .yml record", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:one\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    expectCommandError(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:two"],
        project,
      ),
    );
    await expect(
      readFile(join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml"), "utf8"),
    ).rejects.toThrow();
  });

  test("versions created artifacts, stamps timestamps, and rejects missing, malformed, or unsupported artifact versions", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:one"],
        project,
      ).exitCode,
    ).toBe(0);
    const artifactFile = join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml");
    const artifactText = await readFile(artifactFile, "utf8");
    expect(artifactText).toContain(`format_version: ${CURRENT_FORMAT_VERSION}`);
    expect(artifactText).toMatch(/created_at: \d{4}-\d{2}-\d{2}T/);
    expect(artifactText).toMatch(/updated_at: \d{4}-\d{2}-\d{2}T/);
    for (const replacement of [
      "",
      "format_version: nope",
      `format_version: ${CURRENT_FORMAT_VERSION + 1}`,
    ]) {
      const original = await readFile(artifactFile, "utf8");
      await writeFile(
        artifactFile,
        original.replace(`format_version: ${CURRENT_FORMAT_VERSION}`, replacement),
      );
      const validation = invoke(["map", "validate", "--map", "plan"], project);
      expect(validation.exitCode).toBe(1);
      expectCommandError(invoke(["map", "show", "--map", "plan"], project));
      await writeFile(artifactFile, original);
    }
  });

  test("adds, lists, and satisfies named goals only with existing evidence and no re-satisfaction", async () => {
    const project = await projectFixture();
    expectCommandError(
      invoke(["goal", "add", "--map", "plan", "--description", "Missing name"], project),
    );
    expect(
      invoke(
        ["goal", "add", "--map", "plan", "--name", "release", "--description", "Approved"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(invoke(["goal", "list", "--map", "plan", "--json"], project).exitCode).toBe(0);
    expectCommandError(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "missing"],
        project,
      ),
    );
    expect(
      invoke(
        ["artifact", "add", "approval", "--map", "plan", "--kind", "document", "--ref", "pr:42"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "approval"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "approval"],
        project,
      ),
    );
  });

  test("computes sorted actionable next work and validates without mutation using documented exit codes", async () => {
    const project = await projectFixture();
    await writeStep(project, "later", 2);
    await writeStep(project, "first", 1);
    const next = invoke(["map", "next", "--map", "plan", "--json"], project);
    expect(next.exitCode).toBe(0);
    expect(next.stdout.indexOf("first")).toBeLessThan(next.stdout.indexOf("later"));
    const before = await readFile(join(project, ".wayful", "maps", "plan", "map.toml"), "utf8");
    expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
    expect(await readFile(join(project, ".wayful", "maps", "plan", "map.toml"), "utf8")).toBe(
      before,
    );
  });

  test("reports malformed persisted frontmatter as an invalid map rather than modifying it", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "steps", "1-bad.md"),
      "---\nname: bad\n",
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^wayful: /);
  });

  test("reports null attachments, missing slot arrays, and missing lifecycle fields as invalid maps", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "null-attachment",
      1,
      "inputs: [null]\noutputs: []\nrequired_inputs:\n  - name: source\n    kind: document\nrequired_outputs: []\n",
    );
    let result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid inputs attachment");
    expect(result.stderr).not.toContain("unexpected error");

    const stepFile = join(project, ".wayful", "maps", "plan", "steps", "1-null-attachment.md");
    await writeFile(
      stepFile,
      (await readFile(stepFile, "utf8")).replace(
        "required_inputs:\n  - name: source\n    kind: document\n",
        "",
      ),
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("required_inputs must be an array");

    await rm(stepFile);
    await writeStep(
      project,
      "complete-without-summary",
      2,
      "status: complete\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("completion summary is required");
  });

  test("requires cancellation and block reasons in manually authored steps", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "cancelled-without-reason",
      1,
      "status: cancelled\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    let result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cancellation reason is required");
    await writeFile(
      join(project, ".wayful", "maps", "plan", "steps", "1-cancelled-without-reason.md"),
      (
        await readFile(
          join(project, ".wayful", "maps", "plan", "steps", "1-cancelled-without-reason.md"),
          "utf8",
        )
      ).replace("status: cancelled", "status: blocked"),
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("block reason is required");
  });

  test("rejects unsupported options and extra positionals before mutations", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    const before = await readFile(mapFile, "utf8");
    for (const args of [
      ["map", "create", "unexpected", "--map", "new", "--start", "here", "--goal", "there"],
      [
        "step",
        "create",
        "new-work",
        "extra",
        "--map",
        "plan",
        "--type",
        "task",
        "--description",
        "Must not write",
      ],
      ["artifact", "add", "proof", "extra", "--map", "plan", "--kind", "document", "--ref", "ref"],
      [
        "goal",
        "add",
        "--map",
        "plan",
        "--name",
        "release",
        "--description",
        "Released",
        "--unknown",
        "value",
      ],
      ["init", "unexpected", "--project", join(project, "another")],
    ])
      expectCommandError(invoke(args, project));
    expect(await readFile(mapFile, "utf8")).toBe(before);
    await expect(
      readFile(join(project, ".wayful", "maps", "plan", "steps", "1-new-work.md"), "utf8"),
    ).rejects.toThrow();
    expect(
      invoke(["--project", project, "map", "show", "--map", "plan", "--json"], project).exitCode,
    ).toBe(0);
  });

  test("rejects dangling supplementary attachments and duplicate YAML artifact identities", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "work",
      1,
      "inputs:\n  - artifact: missing\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:one\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:two\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing inputs artifact 'missing'");
    expect(result.stderr).toContain("duplicate artifact identity");
  });

  test("validates manually authored slot attachments in both directions", async () => {
    const project = await projectFixture();
    const artifactDirectory = join(project, ".wayful", "maps", "plan", "artifacts");
    await writeFile(
      join(artifactDirectory, "1-document.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: document\nkind: document\nref: doc\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    await writeFile(
      join(artifactDirectory, "2-image.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 2\nname: image\nkind: image\nref: image\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    const stepDirectory = join(project, ".wayful", "maps", "plan", "steps");
    const manualStep = (id: number, name: string, inputs: string) =>
      writeFile(
        join(stepDirectory, `${id}-${name}.md`),
        `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: ${id}\nname: ${name}\ntype: task\ndescription: Manually edited\nstatus: pending\ndependencies: []\ninputs:\n${inputs}outputs: []\nrequired_inputs:\n  - name: source\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\n`,
      );
    await manualStep(1, "unknown", "  - artifact: document\n    slot: absent\n");
    await manualStep(2, "wrong-direction", "  - artifact: document\n    slot: report\n");
    await manualStep(
      3,
      "duplicate",
      "  - artifact: document\n    slot: source\n  - artifact: document\n    slot: source\n",
    );
    await manualStep(4, "wrong-kind", "  - artifact: image\n    slot: source\n");
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown inputs slot 'absent'");
    expect(result.stderr).toContain("unknown inputs slot 'report'");
    expect(result.stderr).toContain("fulfills inputs slot 'source' more than once");
    expect(result.stderr).toContain("wrong artifact kind to inputs slot 'source'");
  });

  test("validates duplicate manually authored dependencies and incoherent step counters", async () => {
    const project = await projectFixture();
    await writeStep(project, "first", 1);
    await writeStep(project, "second", 4);
    const first = join(project, ".wayful", "maps", "plan", "steps", "1-first.md");
    await writeFile(
      first,
      (await readFile(first, "utf8")).replace("dependencies: []", "dependencies: [4, 4]"),
    );
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    await writeFile(
      mapFile,
      (await readFile(mapFile, "utf8")).replace(/^step_id_counter = \d+$/m, "step_id_counter = 3"),
    );
    const validation = invoke(["map", "validate", "--map", "plan"], project);
    expect(validation.exitCode).toBe(1);
    expect(validation.stderr).toContain("duplicate dependency");
    expect(validation.stderr).toContain(
      "step_id_counter must be greater than every existing step ID",
    );
    expectCommandError(
      invoke(
        [
          "step",
          "create",
          "new-work",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Must not write",
        ],
        project,
      ),
    );
    await expect(
      readFile(join(project, ".wayful", "maps", "plan", "steps", "3-new-work.md"), "utf8"),
    ).rejects.toThrow();
  });

  test("refuses non-create mutations without writing when the step counter is incoherent", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    const stepFile = join(project, ".wayful", "maps", "plan", "steps", "1-work.md");
    await writeFile(
      mapFile,
      (await readFile(mapFile, "utf8")).replace("step_id_counter = 2", "step_id_counter = 1"),
    );
    const beforeMap = await readFile(mapFile, "utf8");
    const beforeStep = await readFile(stepFile, "utf8");

    const result = invoke(
      ["step", "update", "work", "--map", "plan", "--description", "Must not update"],
      project,
    );

    expectCommandError(result);
    expect(result.stderr).toContain("step_id_counter must be greater than every existing step ID");
    expect(await readFile(mapFile, "utf8")).toBe(beforeMap);
    expect(await readFile(stepFile, "utf8")).toBe(beforeStep);
  });

  test("refuses every map mutation when existing map identities are globally invalid", async () => {
    const project = await projectFixture();
    await writeStep(project, "first", 1);
    await writeStep(project, "first", 2);
    const mapDirectory = join(project, ".wayful", "maps", "plan");
    await writeFile(
      join(mapDirectory, "artifacts", "1-existing.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: existing\nkind: document\nref: git:existing\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    const beforeFirst = await readFile(join(mapDirectory, "steps", "1-first.md"), "utf8");
    const beforeSecond = await readFile(join(mapDirectory, "steps", "2-first.md"), "utf8");
    const beforeMap = await readFile(join(mapDirectory, "map.toml"), "utf8");

    expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
    for (const args of [
      ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:one"],
      ["goal", "add", "--map", "plan", "--name", "release", "--description", "Released"],
      ["goal", "satisfy", "--map", "plan", "--goal", "initial-goal", "--artifact", "existing"],
      [
        "step",
        "create",
        "new-work",
        "--map",
        "plan",
        "--type",
        "task",
        "--description",
        "Must not write",
      ],
      ["step", "update", "first", "--map", "plan", "--description", "Must not update"],
      ["step", "block", "first", "--map", "plan", "--reason", "Must not block"],
      ["step", "unblock", "first", "--map", "plan"],
      ["step", "complete", "first", "--map", "plan", "--summary", "Must not complete"],
      ["step", "cancel", "first", "--map", "plan", "--reason", "Must not cancel"],
      ["step", "depends", "first", "--map", "plan", "--on", "2"],
      ["step", "input", "first", "--map", "plan", "--artifact", "existing"],
      ["step", "output", "first", "--map", "plan", "--artifact", "existing"],
    ])
      expectCommandError(invoke(args, project));

    expect(await readFile(join(mapDirectory, "steps", "1-first.md"), "utf8")).toBe(beforeFirst);
    expect(await readFile(join(mapDirectory, "steps", "2-first.md"), "utf8")).toBe(beforeSecond);
    expect(await readFile(join(mapDirectory, "map.toml"), "utf8")).toBe(beforeMap);
    await expect(
      readFile(join(mapDirectory, "artifacts", "2-proof.yaml"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(join(mapDirectory, "goals", "release.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(mapDirectory, "steps", "3-new-work.md"), "utf8")).rejects.toThrow();
  });

  test("serves the viewer API and the bundled client from the project given by --project", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    const elsewhere = await temporaryDirectory();

    // Points `ui` at a minimal client rather than relying on packages/ui
    // having been built — `check` runs before `build` in CI, so neither the
    // embedded map nor a workspace dist/ is guaranteed to exist here.
    const client = await temporaryDirectory();
    await writeFile(join(client, "index.html"), '<!doctype html><div id="root"></div>');

    const ui = await serveInBackground(["ui", "--project", project, "--port", "0"], elsewhere, {
      WAYFUL_UI_DIST: client,
    });
    expect(ui.banner).toContain(project);

    const overview = await fetchJson(ui.url, "/api/overview");
    expect(overview.project.root).toBe(project);
    expect(overview.maps.map((m: { name: string }) => m.name)).toEqual(["plan"]);

    const shell = await fetch(new URL("/maps/plan", ui.url));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('id="root"');
  });

  test("serve exposes the same API without the client", async () => {
    const project = await projectFixture();
    const elsewhere = await temporaryDirectory();

    const api = await serveInBackground(["serve", "--project", project, "--port", "0"], elsewhere);

    const detail = await fetchJson(api.url, "/api/map?name=plan");
    expect(detail.map.name).toBe("plan");
    expect((await fetch(new URL("/", api.url))).status).toBe(404);
  });

  test("renders deterministic human status with goals, counts, blockers, and actionable steps", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["goal", "add", "--map", "plan", "--name", "release", "--description", "Release it"],
        project,
      ).exitCode,
    ).toBe(0);
    await writeStep(project, "ready", 1);
    await writeStep(project, "waiting", 2);
    const waiting = join(project, ".wayful", "maps", "plan", "steps", "2-waiting.md");
    await writeFile(
      waiting,
      (await readFile(waiting, "utf8")).replace(
        "status: pending",
        "status: blocked\nblock_reason: Awaiting approval",
      ),
    );
    const result = invoke(["map", "status", "--map", "plan"], project);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Map plan",
        "Goals: 0/1 satisfied",
        "Steps: 1 pending, 1 blocked, 0 complete, 0 cancelled",
        "Blockers:",
        "- 2 waiting: Awaiting approval",
        "Actionable steps:",
        "- 1 ready: Original description",
        "",
      ].join("\n"),
    );
  });
});
