import { describe, expect, test } from "bun:test";

import { breakStep, expectCommandError, makeCliHarness } from "../../support/cli-harness";

const { invoke, projectFixture, writeGoal, writeStepFixture } = makeCliHarness();

describe("artifact scope", () => {
  const withMap = { WAYFUL_MAP: "plan" };

  test("shows ref and kind", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      outputs: [{ ref: "file:docs/doc.md", kind: "document" }],
    });

    const result = invoke(["context", "file:docs/doc.md", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("artifact");
    expect(view.map).toBe("plan");
    expect(view.ref).toBe("file:docs/doc.md");
    expect(view.kind).toBe("document");

    const human = invoke(["context", "file:docs/doc.md"], project, withMap).stdout;
    expect(human).toContain("Scope: artifact");
    expect(human).toContain("Artifact: file:docs/doc.md (document)");
  });

  test("shows the reverse index: producing steps, consuming steps, and citing goals", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      outputs: [{ ref: "file:shared-doc", kind: "document" }],
    });
    await writeStepFixture(project, {
      id: 2,
      name: "consumer-a",
      inputs: [{ ref: "file:shared-doc", kind: "document" }],
    });
    await writeStepFixture(project, {
      id: 3,
      name: "consumer-b",
      inputs: [{ ref: "file:shared-doc", kind: "document" }],
    });
    await writeStepFixture(project, { id: 4, name: "unrelated" });
    await writeGoal(project, "ship-it", {
      outputs: [{ ref: "file:shared-doc", kind: "document" }],
    });
    await writeGoal(project, "other-goal");

    const result = invoke(["context", "file:shared-doc", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.producedBy).toEqual([{ id: "plan/#1", name: "producer" }]);
    expect(view.consumedBy).toEqual([
      { id: "plan/#2", name: "consumer-a" },
      { id: "plan/#3", name: "consumer-b" },
    ]);
    expect(view.citedByGoals).toEqual(["ship-it"]);

    const human = invoke(["context", "file:shared-doc"], project, withMap).stdout;
    expect(human).toContain("Produced by:");
    expect(human).toContain("- plan/#1 producer");
    expect(human).toContain("Consumed by:");
    expect(human).toContain("- plan/#2 consumer-a");
    expect(human).toContain("- plan/#3 consumer-b");
    expect(human).toContain("Cited by goals:");
    expect(human).toContain("- ship-it");
    expect(human).not.toContain("plan/#4");
  });

  test("reports empty reverse-index sections as none", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "lonely",
      outputs: [{ ref: "file:lonely-doc", kind: "document" }],
    });

    const result = invoke(["context", "file:lonely-doc", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.producedBy).toEqual([{ id: "plan/#1", name: "lonely" }]);
    expect(view.consumedBy).toEqual([]);
    expect(view.citedByGoals).toEqual([]);

    const human = invoke(["context", "file:lonely-doc"], project, withMap).stdout;
    expect(human).toContain("Consumed by:\n- none");
    expect(human).toContain("Cited by goals:\n- none");
  });

  test("addressing an artifact reference that does not exist is an error", async () => {
    const project = await projectFixture();
    expectCommandError(invoke(["context", "file:does-not-exist"], project, withMap));
  });

  test("tolerates a broken sibling step and reports it as a problem, but exits zero", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "good",
      outputs: [{ ref: "file:good-doc", kind: "document" }],
    });
    await writeStepFixture(project, { id: 2, name: "bad" });
    await breakStep(project, "2-bad.md");

    const result = invoke(["context", "file:good-doc", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("artifact");
    expect(view.problems.some((p: { file: string }) => p.file.includes("2-bad.md"))).toBe(true);
  });
});
