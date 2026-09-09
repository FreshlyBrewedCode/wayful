import { describe, expect, test } from "bun:test";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { mapStatus } from "../../src/domain/status";
import { T, map, step } from "./support/fixtures";

describe("mapStatus", () => {
  test("computes step counts, goal progress, blockers, and sorted actionable steps", () => {
    const testMap = map({ step_id_counter: 4 });
    const steps = [
      step({ id: 2, name: "waiting", status: "blocked", block_reason: "Awaiting approval" }),
      step({ id: 1, name: "ready" }),
      step({ id: 3, name: "done", status: "complete", completion_summary: "done" }),
    ];
    const goals = [
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "release",
        description: "Ship",
        evidence: ["proof"],
        body: "",
        created_at: T,
        updated_at: T,
      },
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "other",
        description: "Other",
        evidence: [],
        body: "",
        created_at: T,
        updated_at: T,
      },
    ];
    const status = mapStatus(testMap, steps, [], goals);
    expect(status).toEqual({
      map: "plan",
      goals: { satisfied: 1, total: 2 },
      steps: { pending: 1, blocked: 1, complete: 1, cancelled: 0 },
      blockers: [{ id: 2, name: "waiting", reason: "Awaiting approval" }],
      next: [{ id: 1, name: "ready" }],
    });
  });
});
