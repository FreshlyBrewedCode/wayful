import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { breakStep, expectCommandError, makeCliHarness } from "../../support/cli-harness";

const { invoke, projectFixture, writeStep, writeArtifact, writeGoal, writeStepFixture } =
  makeCliHarness();

describe("map scope", () => {
  test("map scope reports start, goals with satisfied state and qualified evidence, and one-line progress", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "spec", 1);
    await writeGoal(project, "ship-it", { description: "Ship the thing", evidence: ["spec"] });
    await writeGoal(project, "polish", { description: "Polish it" });
    await writeStep(project, "alpha", 1);

    const result = invoke(["context", "plan", "--json"], project);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("map");
    expect(view.map).toBe("plan");
    expect(view.start).toBe("here");
    expect(view.goals).toEqual([
      { name: "polish", description: "Polish it", satisfied: false, evidence: [] },
      {
        name: "ship-it",
        description: "Ship the thing",
        satisfied: true,
        evidence: ["plan/@1"],
      },
    ]);
    expect(view.progress).toEqual({ pending: 1, blocked: 0, complete: 0, cancelled: 0 });

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("Scope: map");
    expect(human).toContain("ship-it: Ship the thing [satisfied] (evidence: plan/@1)");
    expect(human).toContain("polish: Polish it [not satisfied]");
    expect(human).toContain("Progress: 1 pending, 0 blocked, 0 complete, 0 cancelled");
  });

  test("actionable steps are listed first and are never capped", async () => {
    const project = await projectFixture();
    for (let i = 1; i <= 25; i++) await writeStepFixture(project, { id: i, name: `step-${i}` });

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.actionable).toHaveLength(25);
    expect(view.actionable[0]).toEqual({
      id: "plan/#1",
      name: "step-1",
      description: "Original description",
    });
    expect(view.actionable.omitted).toBeUndefined();
  });

  test("blocked steps show their recorded reason and are capped with an omitted count", async () => {
    const project = await projectFixture();
    for (let i = 1; i <= 25; i++)
      await writeStepFixture(project, {
        id: i,
        name: `blocked-${i}`,
        status: "blocked",
        blockReason: `Waiting on external input #${i}`,
      });

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.blocked.items).toHaveLength(20);
    expect(view.blocked.omitted).toBe(5);
    expect(view.blocked.items[0]).toEqual({
      id: "plan/#1",
      name: "blocked-1",
      reason: "Waiting on external input #1",
    });

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("blocked-1: Waiting on external input #1");
    expect(human).toContain("(5 more omitted)");
  });

  test("pending-not-actionable steps distinguish an unmet dependency from a missing input", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "alpha" }); // pending, actionable
    await writeStepFixture(project, {
      id: 2,
      name: "needs-dep",
      dependencies: [1],
    });
    await writeStepFixture(project, {
      id: 3,
      name: "needs-input",
      requiredInputs: [{ name: "brief", kind: "document" }],
    });

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.actionable.map((s: { id: string }) => s.id)).toEqual(["plan/#1"]);

    const byId = (id: string) =>
      view.pendingNotActionable.items.find((s: { id: string }) => s.id === id);
    const needsDep = byId("plan/#2");
    expect(needsDep.reason).toBe("waiting on plan/#1 (pending)");
    expect(needsDep.unmetDependencies).toEqual([
      { id: "plan/#1", name: "alpha", status: "pending" },
    ]);
    expect(needsDep.missingInputs).toEqual([]);

    const needsInput = byId("plan/#3");
    expect(needsInput.reason).toBe("missing input slot 'brief'");
    expect(needsInput.unmetDependencies).toEqual([]);
    expect(needsInput.missingInputs).toEqual(["brief"]);

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("needs-dep: waiting on plan/#1 (pending)");
    expect(human).toContain("needs-input: missing input slot 'brief'");
  });

  test("recent activity covers steps, artifacts, and goals, sorted last-modified descending and capped", async () => {
    const project = await projectFixture();
    for (let i = 1; i <= 15; i++)
      await writeStepFixture(project, {
        id: i,
        name: `step-${i}`,
        updatedAt: `2024-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      });

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.recentActivity.items).toHaveLength(10);
    expect(view.recentActivity.omitted).toBe(5);
    // Most recently updated (step-15) sorts first.
    expect(view.recentActivity.items[0]).toEqual({
      kind: "step",
      id: "plan/#15",
      name: "step-15",
      event: "updated",
      at: "2024-01-01T00:15:00.000Z",
    });
    expect(view.recentActivity.items.at(-1)?.id).toBe("plan/#6");

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("Recent activity:");
    expect(human).toContain("(5 more omitted)");
  });

  test("--since filters recent activity and the completed tail, but never actionable or blocked, and sorting stays descending", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "actionable-step" }); // never touched by --since
    await writeStepFixture(project, {
      id: 2,
      name: "blocked-step",
      status: "blocked",
      blockReason: "still blocked",
      updatedAt: "2024-12-01T00:00:00.000Z",
    });
    await writeStepFixture(project, {
      id: 3,
      name: "completed-step",
      status: "complete",
      completionSummary: "Done",
      updatedAt: "2024-06-01T00:00:00.000Z",
      closedAt: "2024-06-01T00:00:00.000Z",
    });

    // An absolute-date cutoff after the completed step's closed_at, but
    // before the blocked step's last update.
    const absolute = invoke(["context", "plan", "--since", "2024-07-01", "--json"], project);
    expect(absolute.exitCode).toBe(0);
    const absoluteView = JSON.parse(absolute.stdout);
    expect(absoluteView.actionable.map((s: { id: string }) => s.id)).toEqual(["plan/#1"]);
    expect(absoluteView.blocked.items.map((s: { id: string }) => s.id)).toEqual(["plan/#2"]);
    expect(absoluteView.completed.total).toBe(1); // unfiltered total
    expect(absoluteView.completed.recent.items).toEqual([]); // filtered tail
    expect(absoluteView.recentActivity.items.map((e: { id: string }) => e.id)).toEqual(["plan/#2"]);

    // An invalid --since is rejected with the documented failure contract.
    const invalid = invoke(["context", "plan", "--since", "not-a-window"], project);
    expectCommandError(invalid);
    expect(invalid.stderr).toContain("--since must be a duration");

    // A duration wide enough to cover every fixture timestamp (all from
    // 2024, computed relative to the real wall clock) includes everything.
    const wide = invoke(["context", "plan", "--since", "9999d", "--json"], project);
    const wideView = JSON.parse(wide.stdout);
    expect(wideView.completed.total).toBe(1);
    expect(wideView.completed.recent.items).toHaveLength(1);
    expect(wideView.recentActivity.items).toHaveLength(3);
    // Descending order is always on, regardless of --since.
    expect(wideView.recentActivity.items[0].id).toBe("plan/#2");
    expect(wideView.recentActivity.items.at(-1)?.id).toBe("plan/#1");
  });

  test("completed steps report an unfiltered total plus a capped, most-recent tail", async () => {
    const project = await projectFixture();
    for (let i = 1; i <= 8; i++)
      await writeStepFixture(project, {
        id: i,
        name: `done-${i}`,
        status: "complete",
        completionSummary: `Finished step ${i}`,
        updatedAt: `2024-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
        closedAt: `2024-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      });

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.completed.total).toBe(8);
    expect(view.completed.recent.items).toHaveLength(5);
    expect(view.completed.recent.omitted).toBe(3);
    expect(view.completed.recent.items[0]).toEqual({
      id: "plan/#8",
      name: "done-8",
      summary: "Finished step 8",
      closedAt: "2024-01-01T00:08:00.000Z",
    });

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("Completed steps: 8 total");
    expect(human).toContain("done-8: Finished step 8 (closed 2024-01-01T00:08:00.000Z)");
    expect(human).toContain("(3 more omitted)");
  });

  test("artifacts are listed fully qualified and capped with an omitted count", async () => {
    const project = await projectFixture();
    for (let i = 1; i <= 25; i++) await writeArtifact(project, `doc-${i}`, i);

    const result = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(result.stdout);
    expect(view.artifacts.items).toHaveLength(20);
    expect(view.artifacts.omitted).toBe(5);
    expect(view.artifacts.items[0]).toEqual({
      id: "plan/@1",
      name: "doc-1",
      kind: "document",
      ref: "path/doc-1",
    });

    const human = invoke(["context", "plan"], project).stdout;
    expect(human).toContain("plan/@1 doc-1 (document): path/doc-1");
    expect(human).toContain("(5 more omitted)");
  });

  test("--json emits the same derived view as Markdown, never the raw snapshot (no step bodies at map scope)", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "alpha" });

    const jsonResult = invoke(["context", "plan", "--json"], project);
    const view = JSON.parse(jsonResult.stdout);
    expect(view.actionable[0]).not.toHaveProperty("body");
    expect(JSON.stringify(view)).not.toContain("Narrative that must survive");

    const humanResult = invoke(["context", "plan"], project);
    expect(humanResult.stdout).not.toContain("Narrative that must survive");
    expect(humanResult.stdout).toContain("plan/#1 alpha: Original description");
  });

  test("a missing map fails with the documented contract", async () => {
    const project = await projectFixture();

    const human = invoke(["context", "does-not-exist"], project);
    expectCommandError(human);

    const json = invoke(["context", "does-not-exist", "--json"], project);
    expect(json.exitCode).toBe(2);
    expect(JSON.parse(json.stdout)).toHaveProperty("error");
  });

  test("a degraded map read renders healthy records, lists the broken file as a problem, and exits zero", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    const jsonResult = invoke(["context", "plan", "--json"], project);
    expect(jsonResult.exitCode).toBe(0);
    const view = JSON.parse(jsonResult.stdout);
    expect(view.actionable.map((s: { id: string }) => s.id)).toEqual(["plan/#1"]);
    expect(view.problems).toHaveLength(1);
    expect(view.problems[0].file).toContain("2-bad.md");

    const humanResult = invoke(["context", "plan"], project);
    expect(humanResult.exitCode).toBe(0);
    expect(humanResult.stdout).toContain("Problems:");
    expect(humanResult.stdout).toContain("2-bad.md");
  });

  test("project scope tolerates a broken sibling map, but addressing a map with malformed metadata directly is fatal", async () => {
    const project = await projectFixture();
    await writeStep(project, "alpha", 1);
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    await writeFile(mapFile, (await readFile(mapFile, "utf8")).replace('start = "here"', ""));

    // Project scope: the broken map is skipped and reported as a problem —
    // the whole scope does not abort.
    const projectResult = invoke(["context", "--json"], project);
    expect(projectResult.exitCode).toBe(0);
    const projectView = JSON.parse(projectResult.stdout);
    expect(projectView.maps).toEqual([]);
    expect(projectView.problems.length).toBeGreaterThan(0);

    // Map scope: addressing the same broken map directly is fatal.
    expectCommandError(invoke(["context", "plan"], project));
  });
});
