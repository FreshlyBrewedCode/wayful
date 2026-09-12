import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { FIXTURE_TIME, makeCliHarness } from "@test/support/cli-harness";

const { temporaryDirectory, invoke, projectFixture, writeStep } = makeCliHarness();

describe("project scope", () => {
  test("bare context always renders project scope, even with a map named in the environment", async () => {
    const project = await projectFixture();
    await writeStep(project, "alpha", 1);

    const jsonResult = invoke(["context", "--json"], project, { WAYFUL_MAP: "plan" });
    expect(jsonResult.exitCode).toBe(0);
    expect(JSON.parse(jsonResult.stdout).scope).toBe("project");

    const humanResult = invoke(["context"], project, { WAYFUL_MAP: "plan" });
    expect(humanResult.exitCode).toBe(0);
    expect(humanResult.stdout).toContain("Scope: project");
  });

  test("project scope with zero maps renders an empty, non-failing view", async () => {
    const empty = await temporaryDirectory();
    await mkdir(join(empty, ".wayful", "types"), { recursive: true });
    await writeFile(
      join(empty, ".wayful", "project.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "Empty project"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );

    const result = invoke(["context", "--json"], empty);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("project");
    expect(view.maps).toEqual([]);
    expect(view.types).toEqual([]);
    expect(view.problems).toEqual([]);

    const human = invoke(["context"], empty).stdout;
    expect(human).toContain("Maps:\n- none");
  });

  test("context --help documents no --map flag and no --limit flag", async () => {
    const project = await temporaryDirectory();
    const result = invoke(["context", "--help"], project);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--map ");
    expect(result.stdout).not.toContain("--limit");
    expect(result.stdout).toContain("--since");
    expect(result.stdout).toContain("--json");
  });

  test("project scope reports description, root, per-map progress, derived last activity, and step types", async () => {
    const project = await projectFixture();
    await writeStep(project, "alpha", 1, "", { updatedAt: "2024-06-01T00:00:00.000Z" });

    const result = invoke(["context", "--json"], project);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.project).toEqual({ description: "Fixture project", root: project });
    expect(view.maps).toHaveLength(1);
    const map = view.maps[0];
    expect(map.map).toBe("plan");
    expect(map.start).toBe("here");
    expect(map.goals).toEqual({ satisfied: 0, total: 0 });
    expect(map.steps).toEqual({ pending: 1, blocked: 0, complete: 0, cancelled: 0 });
    expect(map.lastActivity).toBe("2024-06-01T00:00:00.000Z");
    expect(view.types).toEqual([{ name: "task", description: "Fixture type" }]);
    expect(view.problems).toEqual([]);

    const human = invoke(["context"], project).stdout;
    expect(human).toContain("Scope: project");
    expect(human).toContain("Fixture project");
    expect(human).toContain(project);
    expect(human).toContain("plan: here");
    expect(human).toContain("task: Fixture type");
  });

  test("project scope orders maps by last activity descending, ties by name, no-activity last", async () => {
    const project = await projectFixture({ map: "b-map" });
    await mkdir(join(project, ".wayful", "maps", "a-map", "steps"), { recursive: true });
    await mkdir(join(project, ".wayful", "maps", "a-map", "goals"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "a-map", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "a-map"\nstart = "here"\nstep_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    await mkdir(join(project, ".wayful", "maps", "c-map", "steps"), { recursive: true });
    await mkdir(join(project, ".wayful", "maps", "c-map", "goals"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "c-map", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "c-map"\nstart = "here"\nstep_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    // b-map and a two-way tie between a-map/c-map (no activity, so tie broken
    // by name); b-map has a single step giving it activity, sorting it first.
    await writeStep(project, "alpha", 1, "", {
      map: "b-map",
      updatedAt: "2024-06-01T00:00:00.000Z",
    });

    const result = invoke(["context", "--json"], project);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.maps.map((m: { map: string }) => m.map)).toEqual(["b-map", "a-map", "c-map"]);
    expect(view.maps[0].lastActivity).toBe("2024-06-01T00:00:00.000Z");
    expect(view.maps[1].lastActivity).toBeUndefined();
    expect(view.maps[2].lastActivity).toBeUndefined();
  });
  test("a step reference without a map in context fails loudly rather than silently rendering project scope", async () => {
    const project = await projectFixture();

    const result = invoke(["context", "#1"], project);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^wayful: /);
    expect(result.stderr).toContain("map context is required");
    expect(result.stdout).not.toContain("Scope: project");
  });

  test("an unrecognized reference sigil is rejected outright", async () => {
    const project = await projectFixture();

    const result = invoke(["context", "@1"], project);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^wayful: /);
    expect(result.stderr).toContain("not a recognized reference sigil");
    expect(result.stdout).not.toContain("Scope: project");
  });

  test("a map-qualified bare name is rejected as ambiguous rather than silently rendering project scope", async () => {
    const project = await projectFixture();

    const result = invoke(["context", "plan/other"], project);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^wayful: /);
    expect(result.stderr).toContain("ambiguous");
    expect(result.stdout).not.toContain("Scope: project");
  });

  test("an unquoted shell-mangled '#1' (zero arguments) still renders project scope, not an error", async () => {
    // This documents the shell hazard the bare-integer grammar exists to
    // avoid: an unquoted `#1` never reaches the CLI at all in `bash -c`, so
    // the only thing under test here is that *passing zero arguments*
    // behaves exactly like bare `wayful context` — proving there is no
    // special-cased "look like a mangled reference" detection to get wrong.
    const project = await projectFixture();
    const result = invoke(["context"], project);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Scope: project");
  });
});
