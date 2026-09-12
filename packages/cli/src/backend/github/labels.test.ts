import { describe, expect, test } from "bun:test";

import { WAYFUL_LABELS } from "@backend/github/labels";

describe("WAYFUL_LABELS", () => {
  test("has a unique, prefixed name and a valid hex color for every label", () => {
    const names = WAYFUL_LABELS.map((label) => label.name);
    expect(new Set(names).size).toBe(names.length);
    for (const label of WAYFUL_LABELS) {
      expect(label.name.startsWith("wayful:")).toBe(true);
      expect(label.color).toMatch(/^[0-9A-Fa-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });

  test("includes the map, step, goal, blocked, and type/task labels", () => {
    const names = WAYFUL_LABELS.map((label) => label.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "wayful:map",
        "wayful:step",
        "wayful:goal",
        "wayful:blocked",
        "wayful:type/task",
      ]),
    );
  });
});
