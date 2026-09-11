import { describe, expect, test } from "bun:test";

import { WayfulError } from "../../src/domain/errors";
import { looksLikeArtifactAddress, parseArtifactAddress } from "../../src/domain/artifact-address";

describe("parseArtifactAddress", () => {
  test("resolves '@id' and '@name' to an artifact by id or by name", () => {
    expect(parseArtifactAddress("@5")).toEqual({
      map: undefined,
      token: { kind: "id", id: 5 },
    });
    expect(parseArtifactAddress("@user-interviews")).toEqual({
      map: undefined,
      token: { kind: "name", name: "user-interviews" },
    });
  });

  test("accepts a map prefix", () => {
    expect(parseArtifactAddress("redesign/@5")).toEqual({
      map: "redesign",
      token: { kind: "id", id: 5 },
    });
    expect(parseArtifactAddress("redesign/@user-interviews")).toEqual({
      map: "redesign",
      token: { kind: "name", name: "user-interviews" },
    });
  });

  test("rejects an empty address", () => {
    expect(() => parseArtifactAddress("")).toThrow(WayfulError);
    expect(() => parseArtifactAddress("   ")).toThrow(/must not be empty/);
  });

  test("rejects a missing '@' sigil", () => {
    expect(() => parseArtifactAddress("5")).toThrow(/not a valid artifact reference/);
    expect(() => parseArtifactAddress("research")).toThrow(/not a valid artifact reference/);
    expect(() => parseArtifactAddress("#5")).toThrow(/not a valid artifact reference/);
  });

  test("rejects an invalid or numeric map prefix", () => {
    expect(() => parseArtifactAddress("Redesign/@1")).toThrow(/invalid map prefix/);
    expect(() => parseArtifactAddress("123/@1")).toThrow(/invalid map prefix/);
  });

  test("rejects a map prefix with nothing after it", () => {
    expect(() => parseArtifactAddress("redesign/")).toThrow(/missing an artifact reference/);
  });

  test("rejects a malformed name after the sigil", () => {
    expect(() => parseArtifactAddress("@Not Valid")).toThrow(/not a valid artifact reference/);
  });
});

describe("looksLikeArtifactAddress", () => {
  test("true for '@id'/'@name', with or without a map prefix", () => {
    expect(looksLikeArtifactAddress("@5")).toBe(true);
    expect(looksLikeArtifactAddress("@user-interviews")).toBe(true);
    expect(looksLikeArtifactAddress("redesign/@5")).toBe(true);
  });

  test("false for step and bare forms", () => {
    expect(looksLikeArtifactAddress("1")).toBe(false);
    expect(looksLikeArtifactAddress("#1")).toBe(false);
    expect(looksLikeArtifactAddress("redesign")).toBe(false);
    expect(looksLikeArtifactAddress("redesign/other")).toBe(false);
  });
});
