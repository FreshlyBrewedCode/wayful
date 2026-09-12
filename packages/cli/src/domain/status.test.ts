import { describe, expect, test } from "bun:test";

import { mapStatus } from "@domain/status";
import { goal, map, step } from "@test/support/domain-fixtures";

describe("mapStatus", () => {
  test("computes step counts, goal progress, blockers, and sorted actionable steps", () => {
    const testMap = map();
    const steps = [
      step({ id: 2, name: "waiting", status: "blocked", block_reason: "Awaiting approval" }),
      step({ id: 1, name: "ready" }),
      step({ id: 3, name: "done", status: "complete", completion_summary: "done" }),
    ];
    const requiredOutputs = [{ name: "evidence", kind: "artifact" }];
    const goals = [
      goal({
        name: "release",
        description: "Ship",
        required_outputs: requiredOutputs,
        outputs: [{ slot: "evidence", ref: "file:proof.md" }],
      }),
      goal({ name: "other", description: "Other", required_outputs: requiredOutputs }),
    ];
    const status = mapStatus(testMap, steps, goals);
    expect(status).toEqual({
      map: "plan",
      goals: { satisfied: 1, total: 2 },
      steps: { pending: 1, blocked: 1, complete: 1, cancelled: 0 },
      blockers: [{ id: 2, name: "waiting", reason: "Awaiting approval" }],
      next: [{ id: 1, name: "ready" }],
    });
  });
});
