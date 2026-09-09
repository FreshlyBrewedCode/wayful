import { afterEach, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";

export const cliRoot = join(import.meta.dir, "..", "..");
export const entrypoint = join(cliRoot, "src", "main.ts");
export const decoder = new TextDecoder();

// A fixed timestamp used only for on-disk fixtures written directly by these
// tests (not produced by the CLI under test), so that fixture files satisfy
// the strict ISO-8601 `created_at`/`updated_at` fields the decoder requires.
export const FIXTURE_TIME = "2024-01-01T00:00:00.000Z";
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Builds one test file's isolated CLI harness: spawn helpers plus fixture
 * writers, with their own `temporaryDirectories`/`spawned` tracking and
 * `afterEach` cleanup registered against whichever file calls this. A shared
 * top-level `afterEach` in this module would only fire once — the first time
 * the module is imported — since ES modules are cached across test files;
 * calling it from inside a factory invoked at each file's top level re-runs
 * the registration, and cleanup, per file.
 */
export function makeCliHarness() {
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

  async function writeStep(
    project: string,
    name: string,
    id: number,
    fields = "",
    options: { map?: string; createdAt?: string; updatedAt?: string } = {},
  ) {
    const map = options.map ?? "plan";
    const createdAt = options.createdAt ?? FIXTURE_TIME;
    const updatedAt = options.updatedAt ?? FIXTURE_TIME;
    const requirements = fields || "required_inputs: []\nrequired_outputs: []\n";
    await writeFile(
      join(project, ".wayful", "maps", map, "steps", `${id}-${name}.md`),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: ${id}\nname: ${name}\ntype: task\ndescription: Original description\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\n${requirements}created_at: ${createdAt}\nupdated_at: ${updatedAt}\n---\nNarrative that must survive frontmatter updates.\n`,
    );
    const mapFile = join(project, ".wayful", "maps", map, "map.toml");
    const metadata = await readFile(mapFile, "utf8");
    const stepIDCounter = Number(metadata.match(/^step_id_counter = (\d+)$/m)?.[1] ?? 1);
    if (stepIDCounter <= id)
      await writeFile(
        mapFile,
        metadata.replace(/^step_id_counter = \d+$/m, `step_id_counter = ${id + 1}`),
      );
  }

  /** Writes an artifact record directly on disk, mirroring `writeStep`. */
  async function writeArtifact(
    project: string,
    name: string,
    id: number,
    options: {
      map?: string;
      kind?: string;
      ref?: string;
      createdAt?: string;
      updatedAt?: string;
    } = {},
  ) {
    const map = options.map ?? "plan";
    const kind = options.kind ?? "document";
    const ref = options.ref ?? `path/${name}`;
    const createdAt = options.createdAt ?? FIXTURE_TIME;
    const updatedAt = options.updatedAt ?? FIXTURE_TIME;
    await writeFile(
      join(project, ".wayful", "maps", map, "artifacts", `${id}-${name}.yaml`),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: ${id}\nname: ${name}\nkind: ${kind}\nref: ${ref}\ncreated_at: ${createdAt}\nupdated_at: ${updatedAt}\n`,
    );
    const mapFile = join(project, ".wayful", "maps", map, "map.toml");
    const metadata = await readFile(mapFile, "utf8");
    const artifactIDCounter = Number(metadata.match(/^artifact_id_counter = (\d+)$/m)?.[1] ?? 1);
    if (artifactIDCounter <= id)
      await writeFile(
        mapFile,
        metadata.replace(/^artifact_id_counter = \d+$/m, `artifact_id_counter = ${id + 1}`),
      );
  }

  /** Writes a goal record directly on disk, mirroring `writeStep`. */
  async function writeGoal(
    project: string,
    name: string,
    options: {
      map?: string;
      description?: string;
      evidence?: string[];
      createdAt?: string;
      updatedAt?: string;
    } = {},
  ) {
    const map = options.map ?? "plan";
    const description = options.description ?? "Original description";
    const evidence = options.evidence ?? [];
    const createdAt = options.createdAt ?? FIXTURE_TIME;
    const updatedAt = options.updatedAt ?? FIXTURE_TIME;
    const evidenceYaml = evidence.length
      ? `evidence:\n${evidence.map((e) => `  - ${e}`).join("\n")}\n`
      : "evidence: []\n";
    await writeFile(
      join(project, ".wayful", "maps", map, "goals", `${name}.md`),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: ${name}\ndescription: ${description}\n${evidenceYaml}created_at: ${createdAt}\nupdated_at: ${updatedAt}\n---\n`,
    );
  }

  /**
   * Writes a step record directly on disk with full control over status,
   * dependencies, and input/output attachments — `writeStep` above only ever
   * produces a bare pending step, which cannot exercise `context` map scope's
   * blocked/pending-not-actionable/completed sections. Conditional fields
   * (`block_reason`, `completion_summary`, `cancellation_reason`, `closed_at`)
   * follow decode.ts's exact validation: required when the status demands it,
   * absent otherwise. Arrays are written as JSON, a valid subset of the YAML
   * Bun's decoder (`Bun.YAML.parse`) accepts, per the existing
   * `dependencies: [4, 4]` fixture elsewhere in this file.
   */
  async function writeStepFixture(
    project: string,
    options: {
      map?: string;
      id: number;
      name: string;
      status?: "pending" | "blocked" | "complete" | "cancelled";
      dependencies?: number[];
      inputs?: Array<{ artifact: string; slot?: string }>;
      outputs?: Array<{ artifact: string; slot?: string }>;
      requiredInputs?: Array<{ name: string; kind: string }>;
      requiredOutputs?: Array<{ name: string; kind: string }>;
      blockReason?: string;
      completionSummary?: string;
      cancellationReason?: string;
      createdAt?: string;
      updatedAt?: string;
      closedAt?: string;
    },
  ) {
    const map = options.map ?? "plan";
    const status = options.status ?? "pending";
    const dependencies = options.dependencies ?? [];
    const inputs = options.inputs ?? [];
    const outputs = options.outputs ?? [];
    const requiredInputs = options.requiredInputs ?? [];
    const requiredOutputs = options.requiredOutputs ?? [];
    const createdAt = options.createdAt ?? FIXTURE_TIME;
    const updatedAt = options.updatedAt ?? FIXTURE_TIME;
    const closesStep = status === "complete" || status === "cancelled";
    const closedAt = options.closedAt ?? (closesStep ? updatedAt : undefined);

    const lines = [
      "---",
      `format_version: ${CURRENT_FORMAT_VERSION}`,
      `id: ${options.id}`,
      `name: ${options.name}`,
      "type: task",
      "description: Original description",
      `status: ${status}`,
      `dependencies: ${JSON.stringify(dependencies)}`,
      `inputs: ${JSON.stringify(inputs)}`,
      `outputs: ${JSON.stringify(outputs)}`,
      `required_inputs: ${JSON.stringify(requiredInputs)}`,
      `required_outputs: ${JSON.stringify(requiredOutputs)}`,
    ];
    if (status === "blocked")
      lines.push(`block_reason: ${JSON.stringify(options.blockReason ?? "Blocked reason")}`);
    if (status === "complete")
      lines.push(
        `completion_summary: ${JSON.stringify(options.completionSummary ?? "Completion summary")}`,
      );
    if (status === "cancelled")
      lines.push(
        `cancellation_reason: ${JSON.stringify(options.cancellationReason ?? "Cancellation reason")}`,
      );
    lines.push(`created_at: ${createdAt}`, `updated_at: ${updatedAt}`);
    if (closedAt) lines.push(`closed_at: ${closedAt}`);
    lines.push("---", "Narrative that must survive frontmatter updates.", "");

    await writeFile(
      join(project, ".wayful", "maps", map, "steps", `${options.id}-${options.name}.md`),
      lines.join("\n"),
    );
    const mapFile = join(project, ".wayful", "maps", map, "map.toml");
    const metadata = await readFile(mapFile, "utf8");
    const stepIDCounter = Number(metadata.match(/^step_id_counter = (\d+)$/m)?.[1] ?? 1);
    if (stepIDCounter <= options.id)
      await writeFile(
        mapFile,
        metadata.replace(/^step_id_counter = \d+$/m, `step_id_counter = ${options.id + 1}`),
      );
  }

  return {
    temporaryDirectory,
    invoke,
    serveInBackground,
    projectFixture,
    writeStep,
    writeArtifact,
    writeGoal,
    writeStepFixture,
  };
}

export const fetchJson = (url: string, path: string): Promise<any> =>
  fetch(new URL(path, url)).then((response) => response.json());

/** Corrupts a persisted step file's frontmatter so it fails to decode. */
export async function breakStep(project: string, filename: string) {
  const file = join(project, ".wayful", "maps", "plan", "steps", filename);
  await writeFile(file, (await readFile(file, "utf8")).replace("status: pending", "status: bogus"));
}

/** Corrupts a persisted artifact file so it fails to decode, mirroring `breakStep`. */
export async function breakArtifact(project: string, filename: string) {
  const file = join(project, ".wayful", "maps", "plan", "artifacts", filename);
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      `format_version: ${CURRENT_FORMAT_VERSION}`,
      `format_version: ${CURRENT_FORMAT_VERSION + 1}`,
    ),
  );
}

export function expectCommandError(result: { exitCode: number; stderr: string }) {
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toMatch(/^wayful: /);
  expect(result.stderr).not.toContain("Error:");
  // A dispatcher placeholder is neither an actionable command error nor a
  // passing implementation of a rejected-operation contract.
  expect(result.stderr).not.toContain("not been bootstrapped");
}

/**
 * Timestamps are stamped by the backend's injected clock and are not
 * predictable from a spawned CLI subprocess, so equality assertions against
 * CLI JSON output strip them; exact values are covered at the backend seam
 * (test/backend/), and `expectTimestamps` below spot-checks shape.
 */
export function omitTimestamps<T>(value: T): T {
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

export function expectTimestamps(record: { created_at: string; updated_at: string }) {
  expect(record.created_at).toMatch(ISO_TIMESTAMP);
  expect(record.updated_at).toMatch(ISO_TIMESTAMP);
}
