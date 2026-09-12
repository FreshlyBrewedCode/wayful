import { describe, expect, test } from "bun:test";

import { WayfulError } from "@domain/errors";
import { formatVersion, identifier, nonEmpty, slots } from "@domain/identifier";
import { CURRENT_FORMAT_VERSION } from "@domain/model";

describe("identifier", () => {
  test("accepts lowercase kebab-case identifiers", () => {
    expect(identifier("release-plan", "map name")).toBe("release-plan");
  });

  test("rejects identifiers with disallowed characters", () => {
    expect(() => identifier("Release Plan", "map name")).toThrow(WayfulError);
    expect(() => identifier("release_plan", "map name")).toThrow(WayfulError);
  });

  test("rejects purely numeric step names when requested", () => {
    expect(() => identifier("123", "step name", true)).toThrow(WayfulError);
    expect(identifier("123", "artifact name")).toBe("123");
  });

  test("nonEmpty rejects blank and non-string values", () => {
    expect(nonEmpty("hello", "label")).toBe("hello");
    expect(() => nonEmpty("   ", "label")).toThrow(/label is required/);
    expect(() => nonEmpty(undefined, "label")).toThrow(/label is required/);
  });

  test("slots validates shape, uniqueness, and optional description", () => {
    expect(slots([{ name: "source", kind: "document" }], "required_inputs")).toEqual([
      { name: "source", kind: "document" },
    ]);
    expect(() => slots("nope", "required_inputs")).toThrow(/must be an array/);
    expect(() => slots(["bad"], "required_inputs")).toThrow(/invalid slot/);
    expect(() =>
      slots(
        [
          { name: "source", kind: "document" },
          { name: "source", kind: "image" },
        ],
        "required_inputs",
      ),
    ).toThrow(/repeats slot 'source'/);
  });

  test("formatVersion enforces presence, integer-ness, and supported version", () => {
    expect(
      formatVersion({ format_version: CURRENT_FORMAT_VERSION }, "map metadata"),
    ).toBeUndefined();
    expect(() => formatVersion({}, "map metadata")).toThrow(/missing format version/);
    expect(formatVersion({}, "map metadata", true)).toBeUndefined();
    expect(() => formatVersion({ format_version: "1" }, "map metadata")).toThrow(
      /malformed format version/,
    );
    expect(() => formatVersion({ format_version: 1 }, "map metadata")).toThrow(
      /unsupported format version/,
    );
  });
});
