import { describe, expect, test } from "bun:test";

import { oneLine } from "@domain/errors";

describe("oneLine", () => {
  test("keeps a single-line diagnosis untouched", () => {
    expect(oneLine("map 'plan' does not exist.")).toBe("map 'plan' does not exist.");
  });

  test("collapses a multi-line backend message onto one line", () => {
    expect(oneLine("github rejected the request:\n  Validation Failed\n  field is required")).toBe(
      "github rejected the request: Validation Failed field is required",
    );
  });

  test("never leaves a leading or trailing blank line", () => {
    expect(oneLine("\n  broken\n")).toBe("broken");
  });
});
