import { describe, expect, test } from "bun:test";

import {
  attachmentErrors,
  attachmentOK,
  dependenciesOK,
  hasDependencyCycle,
  nextSteps,
  reaches,
} from "../../src/domain/graph";
import { artifact, step } from "./support/fixtures";

describe("graph", () => {
  test("attachmentOK is true only when every required slot has a correctly-kinded attachment", () => {
    const required = [{ name: "brief", kind: "document" }];
    const withMatch = step({
      id: 1,
      name: "work",
      required_inputs: required,
      inputs: [{ artifact: "proof", slot: "brief" }],
    });
    const withoutMatch = step({ id: 1, name: "work", required_inputs: required, inputs: [] });
    const artifacts = [artifact({ name: "proof", kind: "document" })];
    expect(attachmentOK(withMatch, "inputs", artifacts)).toBe(true);
    expect(attachmentOK(withoutMatch, "inputs", artifacts)).toBe(false);
  });

  test("attachmentErrors reports missing artifacts, unknown slots, duplicate fulfillment, and kind mismatches", () => {
    const required = [{ name: "source", kind: "document" }];
    const artifacts = [
      artifact({ name: "document", kind: "document" }),
      artifact({ name: "image", kind: "image" }),
    ];

    expect(
      attachmentErrors(
        step({
          id: 1,
          name: "missing",
          required_inputs: required,
          inputs: [{ artifact: "absent" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'missing' has a missing inputs artifact 'absent'."]);

    expect(
      attachmentErrors(
        step({
          id: 2,
          name: "unknown",
          required_inputs: required,
          inputs: [{ artifact: "document", slot: "absent" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'unknown' has an unknown inputs slot 'absent'."]);

    expect(
      attachmentErrors(
        step({
          id: 3,
          name: "duplicate",
          required_inputs: required,
          inputs: [
            { artifact: "document", slot: "source" },
            { artifact: "document", slot: "source" },
          ],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'duplicate' fulfills inputs slot 'source' more than once."]);

    expect(
      attachmentErrors(
        step({
          id: 4,
          name: "wrong-kind",
          required_inputs: required,
          inputs: [{ artifact: "image", slot: "source" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'wrong-kind' attaches wrong artifact kind to inputs slot 'source'."]);

    expect(
      attachmentErrors(
        step({ id: 5, name: "null-attachment", required_inputs: required, inputs: [null] }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'null-attachment' has an invalid inputs attachment."]);
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
    const result = nextSteps(steps, []);
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
