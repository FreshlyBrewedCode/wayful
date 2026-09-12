import { describe, expect, test } from "bun:test";

import {
  attachmentErrors,
  attachmentOK,
  dependenciesOK,
  hasDependencyCycle,
  nextSteps,
  reaches,
} from "@domain/graph";
import { step } from "@test/support/domain-fixtures";

describe("graph", () => {
  test("attachmentOK is true only when every required slot has a slot-bound attachment", () => {
    const required = [{ name: "brief", kind: "document" }];
    expect(attachmentOK(required, [{ slot: "brief", ref: "file:brief.md" }])).toBe(true);
    expect(attachmentOK(required, [])).toBe(false);
  });

  test("attachmentOK ignores supplementary attachments when checking required slots", () => {
    const required = [{ name: "brief", kind: "document" }];
    expect(attachmentOK(required, [{ ref: "file:notes.md", kind: "document" }])).toBe(false);
  });

  test("attachmentErrors reports invalid shapes, unknown slots, and duplicate fulfillment", () => {
    const required = [{ name: "source", kind: "document" }];

    expect(attachmentErrors(required, [{ slot: "source" }], "step 'invalid'", "inputs")).toEqual([
      "step 'invalid' has an invalid inputs attachment.",
    ]);

    expect(
      attachmentErrors(
        required,
        [{ slot: "absent", ref: "file:doc.md" }],
        "step 'unknown'",
        "inputs",
      ),
    ).toEqual(["step 'unknown' has an unknown inputs slot 'absent'."]);

    expect(
      attachmentErrors(
        required,
        [
          { slot: "source", ref: "file:doc.md" },
          { slot: "source", ref: "file:other.md" },
        ],
        "step 'duplicate'",
        "inputs",
      ),
    ).toEqual(["step 'duplicate' fulfills inputs slot 'source' more than once."]);

    expect(
      attachmentErrors(
        required,
        [{ slot: "source", ref: "file:doc.md", kind: "document" }],
        "step 'both-slot-and-kind'",
        "inputs",
      ),
    ).toEqual(["step 'both-slot-and-kind' has an invalid inputs attachment."]);

    expect(attachmentErrors(required, [null], "step 'null-attachment'", "inputs")).toEqual([
      "step 'null-attachment' has an invalid inputs attachment.",
    ]);

    expect(
      attachmentErrors(
        required,
        [{ ref: "file:notes.md", kind: "document" }],
        "step 'supplementary'",
        "inputs",
      ),
    ).toEqual([]);
  });

  test("dependenciesOK requires every dependency to be complete", () => {
    const steps = [
      step({ id: 1, name: "a", status: "complete" }),
      step({ id: 2, name: "b", status: "pending" }),
    ];
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [1] }), steps)).toBe(true);
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [2] }), steps)).toBe(false);
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [99] }), steps)).toBe(false);
  });

  test("nextSteps returns pending, actionable steps sorted by ID", () => {
    const steps = [
      step({ id: 2, name: "later" }),
      step({ id: 1, name: "first" }),
      step({ id: 3, name: "blocked-dep", dependencies: [1] }),
      step({ id: 4, name: "not-pending", status: "complete" }),
    ];
    const result = nextSteps(steps);
    expect(result.map((s) => s.name)).toEqual(["first", "later"]);
  });

  test("reaches detects whether a dependency chain reaches a target ID", () => {
    const steps = [
      step({ id: 1, name: "a" }),
      step({ id: 2, name: "b", dependencies: [1] }),
      step({ id: 3, name: "c", dependencies: [2] }),
    ];
    expect(reaches(steps, 3, 1)).toBe(true);
    expect(reaches(steps, 1, 3)).toBe(false);
    expect(reaches(steps, 1, 1)).toBe(true);
  });

  test("hasDependencyCycle detects cycles but not acyclic graphs", () => {
    const acyclic = [step({ id: 1, name: "a" }), step({ id: 2, name: "b", dependencies: [1] })];
    expect(hasDependencyCycle(acyclic)).toBe(false);
    const cyclic = [
      step({ id: 1, name: "a", dependencies: [2] }),
      step({ id: 2, name: "b", dependencies: [1] }),
    ];
    expect(hasDependencyCycle(cyclic)).toBe(true);
  });
});
