import { describe, expect, test } from "bun:test";

import {
  breakArtifact,
  expectCommandError,
  expectTimestamps,
  makeCliHarness,
} from "../../support/cli-harness";

const { invoke, projectFixture, writeArtifact, writeGoal, writeStepFixture } = makeCliHarness();

describe("artifact scope", () => {
  const withMap = { WAYFUL_MAP: "plan" };

  test("shows id, name, kind, reference, and timestamps", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "doc", 1, { kind: "document", ref: "docs/doc.md" });

    const result = invoke(["context", "@1", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("artifact");
    expect(view.map).toBe("plan");
    expect(view.id).toBe("plan/@1");
    expect(view.name).toBe("doc");
    expect(view.kind).toBe("document");
    expect(view.ref).toBe("docs/doc.md");
    expectTimestamps(view);

    const human = invoke(["context", "@1"], project, withMap).stdout;
    expect(human).toContain("Scope: artifact");
    expect(human).toContain("Artifact: plan/@1 doc (document): docs/doc.md");
  });

  test("shows the reverse index: producing steps, consuming steps, and citing goals", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "shared-doc", 1);
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      requiredOutputs: [{ name: "doc-slot", kind: "document" }],
      outputs: [{ artifact: "shared-doc", slot: "doc-slot" }],
    });
    await writeStepFixture(project, {
      id: 2,
      name: "consumer-a",
      requiredInputs: [{ name: "doc-slot", kind: "document" }],
      inputs: [{ artifact: "shared-doc", slot: "doc-slot" }],
    });
    await writeStepFixture(project, {
      id: 3,
      name: "consumer-b",
      requiredInputs: [{ name: "doc-slot", kind: "document" }],
      inputs: [{ artifact: "shared-doc", slot: "doc-slot" }],
    });
    await writeStepFixture(project, { id: 4, name: "unrelated" });
    await writeGoal(project, "ship-it", { evidence: ["shared-doc"] });
    await writeGoal(project, "other-goal");

    const result = invoke(["context", "@1", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.producedBy).toEqual([{ id: "plan/#1", name: "producer" }]);
    expect(view.consumedBy).toEqual([
      { id: "plan/#2", name: "consumer-a" },
      { id: "plan/#3", name: "consumer-b" },
    ]);
    expect(view.citedByGoals).toEqual(["ship-it"]);

    const human = invoke(["context", "@1"], project, withMap).stdout;
    expect(human).toContain("Produced by:");
    expect(human).toContain("- plan/#1 producer");
    expect(human).toContain("Consumed by:");
    expect(human).toContain("- plan/#2 consumer-a");
    expect(human).toContain("- plan/#3 consumer-b");
    expect(human).toContain("Cited by goals:");
    expect(human).toContain("- ship-it");
    expect(human).not.toContain("plan/#4");
  });

  test("addresses an artifact by name, and reports empty reverse-index sections as none", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "lonely-doc", 1);

    const result = invoke(["context", "@lonely-doc", "--json"], project, withMap);
    const view = JSON.parse(result.stdout);
    expect(view.producedBy).toEqual([]);
    expect(view.consumedBy).toEqual([]);
    expect(view.citedByGoals).toEqual([]);

    const human = invoke(["context", "@lonely-doc"], project, withMap).stdout;
    expect(human).toContain("Produced by:\n- none");
    expect(human).toContain("Consumed by:\n- none");
    expect(human).toContain("Cited by goals:\n- none");
  });

  test("addressing an artifact reference that does not exist is an error", async () => {
    const project = await projectFixture();
    expectCommandError(invoke(["context", "@does-not-exist"], project, withMap));
  });

  test("addressing a malformed artifact directly remains an error rather than an empty answer", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "good", 1);
    await writeArtifact(project, "bad", 2);
    await breakArtifact(project, "2-bad.yaml");

    expectCommandError(invoke(["context", "@2"], project, withMap));
  });

  test("tolerates a broken sibling artifact and reports it as a problem, but exits zero", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "good", 1);
    await writeArtifact(project, "bad", 2);
    await breakArtifact(project, "2-bad.yaml");

    const result = invoke(["context", "@1", "--json"], project, withMap);
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.scope).toBe("artifact");
    expect(view.problems.some((p: { file: string }) => p.file.includes("2-bad.yaml"))).toBe(true);
  });
});
