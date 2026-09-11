import { describe, expect, test } from "bun:test";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { validateMap } from "../../src/domain/validate";
import { T, artifact, map, snapshot, step } from "./support/fixtures";

describe("validateMap", () => {
  test("returns no errors for a coherent, fully-satisfied map", () => {
    const steps = [step({ id: 1, name: "work", status: "complete", completion_summary: "done" })];
    const snap = snapshot({ steps });
    expect(validateMap(snap)).toEqual([]);
  });

  test("flags duplicate step identity and duplicate artifact identity", () => {
    const snap = snapshot({
      steps: [
        step({ id: 1, name: "work", status: "complete", completion_summary: "done" }),
        step({ id: 1, name: "work", status: "complete", completion_summary: "done" }),
      ],
      artifacts: [artifact({ name: "proof" }), artifact({ name: "proof" })],
    });
    const errors = validateMap(snap);
    expect(errors).toContain("duplicate step identity.");
    expect(errors).toContain("duplicate artifact identity.");
  });

  test("flags an unknown or disallowed step type", () => {
    const unknownType = snapshot({
      steps: [
        step({
          id: 1,
          name: "work",
          type: "missing",
          status: "complete",
          completion_summary: "done",
        }),
      ],
      types: [],
    });
    expect(validateMap(unknownType)).toContain("type 'missing' does not exist.");

    const disallowed = snapshot({
      map: map({ allowed_step_types: ["other"] }),
      steps: [
        step({ id: 1, name: "work", type: "task", status: "complete", completion_summary: "done" }),
      ],
    });
    expect(validateMap(disallowed)).toContain("step 'work' has a disallowed type.");
  });

  test("flags missing, duplicate, and cancelled-prerequisite dependencies", () => {
    const missing = snapshot({
      steps: [step({ id: 1, name: "a", dependencies: [99] })],
    });
    expect(validateMap(missing, { includeProgress: false })).toContain(
      "step 'a' has a missing dependency.",
    );

    const duplicate = snapshot({
      steps: [
        step({ id: 1, name: "a", status: "complete", completion_summary: "done" }),
        step({ id: 2, name: "b", dependencies: [1, 1] }),
      ],
    });
    expect(validateMap(duplicate, { includeProgress: false })).toContain(
      "step 'b' has a duplicate dependency.",
    );

    const cancelled = snapshot({
      steps: [
        step({ id: 1, name: "a", status: "cancelled", cancellation_reason: "obsolete" }),
        step({ id: 2, name: "b", dependencies: [1] }),
      ],
    });
    expect(validateMap(cancelled, { includeProgress: false })).toContain(
      "step 'b' depends on cancelled step 'a'.",
    );
  });

  test("flags unmet required inputs and unmet completed-step outputs", () => {
    const requiredInputs = [{ name: "brief", kind: "document" }];
    const missingInput = snapshot({
      steps: [step({ id: 1, name: "work", required_inputs: requiredInputs })],
    });
    expect(validateMap(missingInput)).toContain("step 'work' has unmet required inputs.");
    expect(validateMap(missingInput, { includeProgress: false })).not.toContain(
      "step 'work' has unmet required inputs.",
    );

    const requiredOutputs = [{ name: "report", kind: "document" }];
    const missingOutput = snapshot({
      steps: [
        step({
          id: 1,
          name: "work",
          status: "complete",
          completion_summary: "done",
          required_outputs: requiredOutputs,
        }),
      ],
    });
    expect(validateMap(missingOutput, { includeProgress: false })).toContain(
      "completed step 'work' has unmet required outputs.",
    );
  });

  test("flags blocked and pending steps only when includeProgress is true", () => {
    const snap = snapshot({
      steps: [
        step({ id: 1, name: "blocked", status: "blocked", block_reason: "waiting" }),
        step({ id: 2, name: "pending" }),
      ],
    });
    expect(validateMap(snap)).toEqual(
      expect.arrayContaining(["step 'blocked' is blocked.", "step 'pending' remains pending."]),
    );
    expect(validateMap(snap, { includeProgress: false })).toEqual([]);
  });

  test("flags dependency cycles", () => {
    const snap = snapshot({
      steps: [
        step({ id: 1, name: "a", dependencies: [2] }),
        step({ id: 2, name: "b", dependencies: [1] }),
      ],
    });
    expect(validateMap(snap, { includeProgress: false })).toContain("dependency cycle detected.");
  });

  test("flags unsatisfied and missing-evidence goals", () => {
    const unsatisfied = snapshot({
      goals: [
        {
          format_version: CURRENT_FORMAT_VERSION,
          name: "release",
          description: "Ship",
          evidence: [],
          body: "",
          created_at: T,
          updated_at: T,
        },
      ],
    });
    expect(validateMap(unsatisfied)).toContain("goal 'release' is not satisfied.");
    expect(validateMap(unsatisfied, { includeProgress: false })).not.toContain(
      "goal 'release' is not satisfied.",
    );

    const missingEvidence = snapshot({
      goals: [
        {
          format_version: CURRENT_FORMAT_VERSION,
          name: "release",
          description: "Ship",
          evidence: ["absent"],
          body: "",
          created_at: T,
          updated_at: T,
        },
      ],
    });
    expect(validateMap(missingEvidence, { includeProgress: false })).toContain(
      "goal 'release' has missing evidence.",
    );
  });
});
