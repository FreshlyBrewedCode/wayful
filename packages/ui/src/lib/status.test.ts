import { describe, expect, test } from "bun:test";

import { DISPLAY_STATUSES, displayStatus, groupByDisplayStatus, statusLabel } from "@/lib/status";
import { step } from "@test/fixtures";

describe("displayStatus", () => {
  test("a pending step listed by `map next` shows as ready", () => {
    expect(displayStatus(step(1, { status: "pending" }), [1])).toBe("ready");
  });

  test("a pending step not listed by `map next` stays pending", () => {
    expect(displayStatus(step(1, { status: "pending" }), [2])).toBe("pending");
  });

  test("the four persisted statuses pass through unchanged", () => {
    expect(displayStatus(step(1, { status: "blocked" }), [])).toBe("blocked");
    expect(displayStatus(step(2, { status: "complete" }), [])).toBe("complete");
    expect(displayStatus(step(3, { status: "cancelled" }), [])).toBe("cancelled");
    expect(displayStatus(step(4, { status: "pending" }), [])).toBe("pending");
  });

  test("`ready` is never derived for a non-pending step, even if the CLI lists it", () => {
    // Defensive: `map next` only returns pending steps, but the viewer must not
    // invent a status the CLI would not agree with.
    expect(displayStatus(step(1, { status: "blocked" }), [1])).toBe("blocked");
    expect(displayStatus(step(2, { status: "complete" }), [2])).toBe("complete");
  });
});

describe("statusLabel", () => {
  test("every display status has a human label", () => {
    for (const status of DISPLAY_STATUSES) {
      expect(statusLabel(status)).toBeTruthy();
    }
  });
});

describe("groupByDisplayStatus", () => {
  test("groups in board order and keeps every column present", () => {
    const steps = [
      step(1, { status: "complete" }),
      step(2, { status: "pending" }),
      step(3, { status: "pending" }),
      step(4, { status: "blocked" }),
    ];
    const groups = groupByDisplayStatus(steps, [2]);

    expect([...groups.keys()]).toEqual([...DISPLAY_STATUSES]);
    expect(groups.get("ready")?.map((s) => s.id)).toEqual([2]);
    expect(groups.get("pending")?.map((s) => s.id)).toEqual([3]);
    expect(groups.get("blocked")?.map((s) => s.id)).toEqual([4]);
    expect(groups.get("complete")?.map((s) => s.id)).toEqual([1]);
    expect(groups.get("cancelled")).toEqual([]);
  });
});
