import { describe, expect, test } from "bun:test";

import {
  breakStep,
  expectCommandError,
  expectTimestamps,
  makeCliHarness,
} from "@test/support/cli-harness";

const { invoke, projectFixture, writeStep, writeStepFixture } = makeCliHarness();

describe("step scope", () => {
  // `context` has no `--map` flag (verified above); every case here relies
  // on WAYFUL_MAP or a map-qualified reference to supply the map, exactly
  // like the reference grammar's own contract.
  const withMap = { WAYFUL_MAP: "plan" };

  test("shows id, name, type, status, description, and timestamps", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "alpha" });

    const result = invoke(["context", "#1", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("step");
    expect(view.map).toBe("plan");
    expect(view.id).toBe("plan/#1");
    expect(view.name).toBe("alpha");
    expect(view.type).toEqual({ name: "task", description: "Fixture type" });
    expect(view.status).toBe("pending");
    expect(view.description).toBe("Original description");
    expectTimestamps(view);
    expect(view.closed_at).toBeUndefined();
    expect(view).not.toHaveProperty("body");
    expect(JSON.stringify(view)).not.toContain("Narrative that must survive");

    const human = invoke(["context", "#1"], project, withMap).stdout;
    expect(human).toContain("Scope: step");
    expect(human).toContain("Step: plan/#1 alpha");
    expect(human).toContain("Type: task: Fixture type");
    expect(human).toContain("Status: pending");
    expect(human).not.toContain("Narrative that must survive");
  });

  test("addresses a step by bare integer id when WAYFUL_MAP is set", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "alpha" });

    const result = invoke(["context", "1", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).id).toBe("plan/#1");
  });

  test("reports closed_at once a step is complete", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "done",
      status: "complete",
      completionSummary: "Finished",
      closedAt: "2024-06-01T00:00:00.000Z",
    });

    const result = invoke(["context", "#done", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.closed_at).toBe("2024-06-01T00:00:00.000Z");

    const human = invoke(["context", "#done"], project, withMap).stdout;
    expect(human).toContain("Closed: 2024-06-01T00:00:00.000Z");
  });

  test("shows upstream dependencies with their current status, including a missing dependency", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "upstream-pending" });
    await writeStepFixture(project, {
      id: 2,
      name: "upstream-complete",
      status: "complete",
      completionSummary: "Done",
    });
    await writeStepFixture(project, {
      id: 3,
      name: "downstream",
      dependencies: [1, 2],
    });

    const result = invoke(["context", "#downstream", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.dependencies).toEqual([
      { id: "plan/#1", name: "upstream-pending", status: "pending" },
      { id: "plan/#2", name: "upstream-complete", status: "complete" },
    ]);

    const human = invoke(["context", "#downstream"], project, withMap).stdout;
    expect(human).toContain("plan/#1 upstream-pending [pending]");
    expect(human).toContain("plan/#2 upstream-complete [complete]");
  });

  test("shows downstream dependents — steps waiting on this one", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "base" });
    await writeStepFixture(project, { id: 2, name: "waiter-a", dependencies: [1] });
    await writeStepFixture(project, { id: 3, name: "waiter-b", dependencies: [1] });
    await writeStepFixture(project, { id: 4, name: "unrelated" });

    const result = invoke(["context", "#1", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.dependents).toEqual([
      { id: "plan/#2", name: "waiter-a", status: "pending" },
      { id: "plan/#3", name: "waiter-b", status: "pending" },
    ]);

    const human = invoke(["context", "#1"], project, withMap).stdout;
    expect(human).toContain("Dependents:");
    expect(human).toContain("plan/#2 waiter-a [pending]");
    expect(human).toContain("plan/#3 waiter-b [pending]");
    expect(human).not.toContain("plan/#4");
  });

  test("shows input attachments with their slot, ref, and kind, including a supplementary attachment", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "consumer",
      requiredInputs: [{ name: "brief-slot", kind: "document" }],
      inputs: [
        { ref: "docs/brief.md", slot: "brief-slot" },
        { ref: "docs/notes.md", kind: "note" },
      ],
    });

    const result = invoke(["context", "#1", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.inputs).toEqual([
      { slot: "brief-slot", ref: "docs/brief.md", kind: "document" },
      { slot: undefined, ref: "docs/notes.md", kind: "note" },
    ]);

    const human = invoke(["context", "#1"], project, withMap).stdout;
    expect(human).toContain("[brief-slot] docs/brief.md (document)");
    expect(human).toContain("docs/notes.md (note)");
  });

  test("shows recorded outputs alongside required output slots still unfilled", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      requiredOutputs: [
        { name: "result-slot", kind: "document" },
        { name: "review-slot", kind: "verdict" },
      ],
      outputs: [{ ref: "path/result", slot: "result-slot" }],
    });

    const result = invoke(["context", "#1", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.outputs.recorded).toEqual([
      { slot: "result-slot", ref: "path/result", kind: "document" },
    ]);
    expect(view.outputs.unfulfilled).toEqual([{ name: "review-slot", kind: "verdict" }]);

    const human = invoke(["context", "#1"], project, withMap).stdout;
    expect(human).toContain("Outputs:");
    expect(human).toContain("[result-slot] path/result (document)");
    expect(human).toContain("Unfulfilled output slots:");
    expect(human).toContain("- review-slot (verdict)");
  });

  test("tolerates a broken sibling step and reports it as a problem, but exits zero", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    const result = invoke(["context", "#1", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("step");
    expect(view.problems).toHaveLength(1);
    expect(view.problems[0].file).toContain("2-bad.md");
  });

  test("addressing a step reference that does not exist is an error", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, { id: 1, name: "alpha" });
    expectCommandError(invoke(["context", "#not-a-step"], project, withMap));
  });

  test("addressing a malformed step directly remains an error rather than an empty answer", async () => {
    const project = await projectFixture();
    await writeStep(project, "good", 1);
    await writeStep(project, "bad", 2);
    await breakStep(project, "2-bad.md");

    expectCommandError(invoke(["context", "#2"], project, withMap));
  });

  test("accepts a map-qualified step reference regardless of WAYFUL_MAP", async () => {
    const project = await projectFixture({ map: "other" });
    await writeStepFixture(project, { id: 1, name: "alpha", map: "other" });

    const result = invoke(["context", "other/#1", "--json"], project, { WAYFUL_MAP: "plan" });
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.map).toBe("other");
    expect(view.id).toBe("other/#1");
  });
});
