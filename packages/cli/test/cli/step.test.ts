import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import {
  FIXTURE_TIME,
  decoder,
  entrypoint,
  expectCommandError,
  makeCliHarness,
} from "../support/cli-harness";

const { invoke, projectFixture, writeStep } = makeCliHarness();

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

  test("accepts a bare numeric id in a sigil'd slot, unqualified or map-qualified", async () => {
    const project = await projectFixture();
    await writeStep(project, "a", 1);
    await writeStep(project, "b", 2);
    // Bare integers are decidable without a sigil everywhere the grammar is
    // accepted, including flags like --on: only a name needs '#'.
    expect(invoke(["step", "depends", "2", "--map", "plan", "--on", "1"], project).exitCode).toBe(
      0,
    );
    expect(invoke(["step", "show", "plan/#1", "--map", "plan", "--json"], project).exitCode).toBe(
      0,
    );
  });

  test("rejects an unrecognized reference sigil", async () => {
    const project = await projectFixture();
    await writeStep(project, "a", 1);
    expectCommandError(invoke(["step", "show", "%a", "--map", "plan"], project));
  });

  test("resolves a map-qualified step reference without --map or WAYFUL_MAP", async () => {
    const project = await projectFixture();
    await writeStep(project, "a", 1);
    const result = invoke(["step", "show", "plan/#a", "--json"], project);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).name).toBe("a");
  });

  test("rejects a dependency that crosses maps", async () => {
    const project = await projectFixture();
    await writeStep(project, "a", 1);
    await writeStep(project, "b", 2);
    await mkdir(join(project, ".wayful", "maps", "other", "steps"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "other", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "other"\nstart = "there"\nstep_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    await writeFile(
      join(project, ".wayful", "maps", "other", "steps", "1-c.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: c\ntype: task\ndescription: Original description\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\n`,
    );
    const dependsAcrossMaps = invoke(
      ["step", "depends", "#a", "--map", "plan", "--on", "other/#c"],
      project,
    );
    expectCommandError(dependsAcrossMaps);
    expect(dependsAcrossMaps.stderr).toContain("cannot cross maps");
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "steps", "1-a.md"), "utf8"),
    ).toContain("dependencies: []");
  });

  test("passes an unquoted bare integer step id through a shell intact", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    const result = Bun.spawnSync({
      cmd: [
        "sh",
        "-c",
        `${process.execPath} ${entrypoint} step show 1 --map plan --project ${project} --json`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(result.stdout)).id).toBe(1);
  });
});
