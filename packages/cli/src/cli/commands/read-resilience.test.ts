import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { breakStep, expectCommandError, makeCliHarness } from "@test/support/cli-harness";

const { invoke, projectFixture, writeStep } = makeCliHarness();

describe("read resilience: skip-and-collect on malformed records", () => {
  test("map show renders the healthy step and reports the broken sibling, in both human and JSON output", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    const jsonResult = invoke(["map", "show", "--map", "plan", "--json"], project);
    expect(jsonResult.exitCode).toBe(0);
    const shown = JSON.parse(jsonResult.stdout);
    expect(shown.steps.map((s: { name: string }) => s.name)).toEqual(["good"]);
    expect(shown.errors).toHaveLength(1);
    expect(shown.errors[0].file).toBe("2-bad.md");
    expect(shown.errors[0].message).toEqual(expect.any(String));

    const humanResult = invoke(["map", "show", "--map", "plan"], project);
    expect(humanResult.exitCode).toBe(0);
    expect(humanResult.stdout).toContain("- 1 good: Original description");
    expect(humanResult.stdout).not.toContain("- 2 bad:");
    expect(humanResult.stdout).toContain("Errors:");
    expect(humanResult.stdout).toContain("2-bad.md");
  });

  test("map status and map next also render around a broken step rather than failing", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    const status = invoke(["map", "status", "--map", "plan", "--json"], project);
    expect(status.exitCode).toBe(0);
    const statusValue = JSON.parse(status.stdout);
    expect(statusValue.errors).toHaveLength(1);
    expect(statusValue.errors[0].file).toBe("2-bad.md");

    const next = invoke(["map", "next", "--map", "plan", "--json"], project);
    expect(next.exitCode).toBe(0);
    const nextValue = JSON.parse(next.stdout);
    expect(nextValue.steps.map((s: { name: string }) => s.name)).toEqual(["good"]);
    expect(nextValue.errors).toHaveLength(1);
    expect(nextValue.errors[0].file).toBe("2-bad.md");
  });

  test("malformed project metadata remains fatal even though step decode errors are tolerated elsewhere", async () => {
    const project = await projectFixture();
    await writeFile(join(project, ".wayful", "project.toml"), "not valid toml at all {{{");
    expectCommandError(invoke(["map", "show", "--map", "plan"], project));
  });

  test("malformed map metadata remains fatal even though step decode errors are tolerated elsewhere", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "map.toml"),
      "not valid toml at all {{{",
    );
    expectCommandError(invoke(["map", "show", "--map", "plan"], project));
  });

  test("addressing a malformed step directly remains an error", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    expectCommandError(invoke(["step", "show", "2", "--map", "plan"], project));
  });

  test("the write path's integrity check blocks on a decode error even though map show tolerates it", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    // Reading is lenient here...
    expect(invoke(["map", "show", "--map", "plan"], project).exitCode).toBe(0);
    // ...but writing is not: the broken sibling still blocks every mutation.
    expectCommandError(
      invoke(
        ["step", "create", "third", "--map", "plan", "--type", "task", "--description", "New"],
        project,
      ),
    );
    expectCommandError(
      invoke(["step", "update", "good", "--map", "plan", "--description", "Changed"], project),
    );
  });

  test("map validate treats decode errors as blocking and reports every malformed file", async () => {
    const project = await projectFixture();
    await writeStep(project, "one", 1);
    await writeStep(project, "two", 2);
    await breakStep(project, "1-one.md");
    await breakStep(project, "2-two.md");

    const result = invoke(["map", "validate", "--map", "plan", "--json"], project);
    expect(result.exitCode).toBe(1);
    const validation = JSON.parse(result.stdout);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e: string) => e.includes("1-one.md"))).toBe(true);
    expect(validation.errors.some((e: string) => e.includes("2-two.md"))).toBe(true);
  });
});
