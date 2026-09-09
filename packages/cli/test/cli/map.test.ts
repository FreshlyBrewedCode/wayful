import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import {
  FIXTURE_TIME,
  expectCommandError,
  expectTimestamps,
  makeCliHarness,
  omitTimestamps,
} from "../support/cli-harness";

const { temporaryDirectory, invoke, projectFixture } = makeCliHarness();

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
