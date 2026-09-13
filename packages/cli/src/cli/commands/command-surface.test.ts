import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { expectCommandError, makeCliHarness } from "@test/support/cli-harness";

const { invoke, projectFixture, writeGoal, writeStep, writeStepFixture } = makeCliHarness();

/** Adds a second project type, so an excluded type is a real choice rather than a missing one. */
async function addType(project: string, name: string) {
  await writeFile(
    join(project, ".wayful", "types", `${name}.md`),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: ${name}\ndescription: Another type\nrequired_inputs: []\nrequired_outputs: []\n---\n`,
  );
}

describe("map archiving", () => {
  test("archives, hides from the default listing, reports archived on map-scoped commands, and restores intact", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    await writeGoal(project, "ship", { description: "Ship it" });

    expect(invoke(["map", "archive", "--map", "plan"], project).exitCode).toBe(0);

    expect(invoke(["map", "list"], project).stdout).not.toContain("plan");
    const all = invoke(["map", "list", "--all"], project);
    expect(all.exitCode).toBe(0);
    expect(all.stdout).toContain("plan (archived): here");
    const allJson = JSON.parse(invoke(["map", "list", "--all", "--json"], project).stdout);
    expect(allJson[0].name).toBe("plan");
    expect(allJson[0].archived).toBe(true);

    // A map-scoped command names the archive and the way back, rather than
    // claiming the map does not exist.
    const scoped = invoke(["map", "show", "--map", "plan"], project);
    expectCommandError(scoped);
    expect(scoped.stderr).toContain("archived");
    expect(scoped.stderr).toContain("wayful map unarchive --map plan");
    expect(invoke(["step", "show", "1", "--map", "plan"], project).exitCode).toBe(2);

    // Archiving an already-archived map is refused.
    expectCommandError(invoke(["map", "archive", "--map", "plan"], project));

    expect(invoke(["map", "unarchive", "--map", "plan"], project).exitCode).toBe(0);
    expect(invoke(["map", "list"], project).stdout).toContain("plan: here");
    expect(invoke(["step", "show", "1", "--map", "plan"], project).exitCode).toBe(0);
    expect(invoke(["goal", "show", "--map", "plan", "--goal", "ship"], project).exitCode).toBe(0);
    expectCommandError(invoke(["map", "unarchive", "--map", "plan"], project));

    const mapFile = await readFile(join(project, ".wayful", "maps", "plan", "map.toml"), "utf8");
    expect(mapFile).not.toContain("archived_at");
  });

  test("a missing map still reports that it does not exist", async () => {
    const project = await projectFixture();
    const result = invoke(["map", "archive", "--map", "ghost"], project);
    expectCommandError(result);
    expect(result.stderr).toContain("does not exist");
  });
});

describe("map type restrictions", () => {
  test("map create accepts a restriction and step create refuses an excluded type", async () => {
    const project = await projectFixture();
    await addType(project, "research");

    expect(
      invoke(
        [
          "map",
          "create",
          "--map",
          "focused",
          "--start",
          "here",
          "--goal",
          "done",
          "--allowed-step-types",
          "task",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      JSON.parse(invoke(["map", "show", "--map", "focused", "--json"], project).stdout)
        .allowed_step_types,
    ).toEqual(["task"]);
    expect(invoke(["map", "show", "--map", "focused"], project).stdout).toContain(
      "Allowed step types: task",
    );

    expect(
      invoke(
        ["step", "create", "work", "--map", "focused", "--type", "task", "--description", "Do it"],
        project,
      ).exitCode,
    ).toBe(0);
    const refused = invoke(
      [
        "step",
        "create",
        "study",
        "--map",
        "focused",
        "--type",
        "research",
        "--description",
        "Read it",
      ],
      project,
    );
    expectCommandError(refused);
    expect(refused.stderr).toContain("not allowed");

    expectCommandError(
      invoke(
        [
          "map",
          "create",
          "--map",
          "bad",
          "--start",
          "here",
          "--goal",
          "done",
          "--allowed-step-types",
          "ghost",
        ],
        project,
      ),
    );
  });

  test("restrict sets and clears the restriction on an existing map", async () => {
    const project = await projectFixture();
    await addType(project, "research");

    expect(
      invoke(["map", "restrict", "--map", "plan", "--allowed-step-types", "task"], project)
        .exitCode,
    ).toBe(0);
    expect(
      JSON.parse(invoke(["map", "show", "--map", "plan", "--json"], project).stdout)
        .allowed_step_types,
    ).toEqual(["task"]);
    expectCommandError(
      invoke(
        [
          "step",
          "create",
          "study",
          "--map",
          "plan",
          "--type",
          "research",
          "--description",
          "Read it",
        ],
        project,
      ),
    );

    expect(invoke(["map", "restrict", "--map", "plan", "--clear"], project).exitCode).toBe(0);
    expect(
      JSON.parse(invoke(["map", "show", "--map", "plan", "--json"], project).stdout)
        .allowed_step_types,
    ).toBeUndefined();
    expect(
      invoke(
        [
          "step",
          "create",
          "study",
          "--map",
          "plan",
          "--type",
          "research",
          "--description",
          "Read it",
        ],
        project,
      ).exitCode,
    ).toBe(0);

    expectCommandError(invoke(["map", "restrict", "--map", "plan"], project));
    expectCommandError(
      invoke(
        ["map", "restrict", "--map", "plan", "--clear", "--allowed-step-types", "task"],
        project,
      ),
    );
    expectCommandError(
      invoke(["map", "restrict", "--map", "plan", "--allowed-step-types", "ghost"], project),
    );
  });
});

describe("context --map", () => {
  test("renders artifact scope with no WAYFUL_MAP set", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      outputs: [{ ref: "file:docs/doc.md", kind: "document" }],
    });

    const result = invoke(["context", "file:docs/doc.md", "--map", "plan", "--json"], project);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("artifact");
    expect(view.map).toBe("plan");
    expect(view.ref).toBe("file:docs/doc.md");
  });
});

describe("goal show", () => {
  test("reports description, body, required outputs, and current attachments", async () => {
    const project = await projectFixture();
    await writeGoal(project, "ship", {
      description: "Ship it",
      outputs: [
        { ref: "file:proof.md", slot: "evidence" },
        { ref: "git:notes", kind: "document" },
      ],
      requiredOutputs: [{ name: "evidence", kind: "artifact" }],
    });

    const result = invoke(["goal", "show", "--map", "plan", "--goal", "ship", "--json"], project);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.name).toBe("ship");
    expect(view.description).toBe("Ship it");
    expect(view.required_outputs).toEqual([{ name: "evidence", kind: "artifact" }]);
    expect(view.outputs).toEqual([
      { ref: "file:proof.md", slot: "evidence" },
      { ref: "git:notes", kind: "document" },
    ]);

    const human = invoke(["goal", "show", "--map", "plan", "--goal", "ship"], project).stdout;
    expect(human).toContain("ship: Ship it");
    expect(human).toContain("Required outputs:\n- evidence (artifact)");
    expect(human).toContain("- evidence: file:proof.md");
    expect(human).toContain("- git:notes (document)");

    expectCommandError(invoke(["goal", "show", "--map", "plan", "--goal", "missing"], project));
  });
});
