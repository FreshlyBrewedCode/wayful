import { describe, expect, test } from "bun:test";

import { WayfulError } from "@domain/errors";
import {
  assertSameMap,
  describeToken,
  expectStep,
  parseReference,
  resolveToken,
} from "@domain/reference";

describe("parseReference", () => {
  test("resolves a bare integer to a step id, unqualified", () => {
    expect(parseReference("1")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "id", id: 1 },
    });
  });

  test("resolves a bare kebab-case name to a neutral 'bare' token, unqualified", () => {
    // The grammar is additive: a bare name is inherently ambiguous (map or
    // step) outside a sigil, so parseReference itself stays agnostic and
    // leaves the call site to decide (see expectStep below).
    expect(parseReference("redesign")).toEqual({
      kind: "bare",
      map: undefined,
      name: "redesign",
    });
  });

  test("resolves '#id' and '#name' to a step by id or by name", () => {
    expect(parseReference("#1")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "id", id: 1 },
    });
    expect(parseReference("#research-users")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "name", name: "research-users" },
    });
  });

  test("accepts a map prefix on the bare-integer and '#' forms", () => {
    expect(parseReference("redesign/1")).toEqual({
      kind: "step",
      map: "redesign",
      token: { kind: "id", id: 1 },
    });
    expect(parseReference("redesign/#1")).toEqual({
      kind: "step",
      map: "redesign",
      token: { kind: "id", id: 1 },
    });
    expect(parseReference("redesign/#research-users")).toEqual({
      kind: "step",
      map: "redesign",
      token: { kind: "name", name: "research-users" },
    });
  });

  test("rejects an empty reference", () => {
    expect(() => parseReference("")).toThrow(WayfulError);
    expect(() => parseReference("   ")).toThrow(/must not be empty/);
  });

  test("rejects an unrecognized sigil, including the artifact '@' sigil", () => {
    expect(() => parseReference("%5")).toThrow(/not a recognized reference sigil/);
    expect(() => parseReference("!research")).toThrow(/not a recognized reference sigil/);
    expect(() => parseReference("@5")).toThrow(/not a recognized reference sigil/);
  });

  test("rejects an invalid or numeric map prefix", () => {
    expect(() => parseReference("Redesign/#1")).toThrow(/invalid map prefix/);
    expect(() => parseReference("123/#1")).toThrow(/invalid map prefix/);
  });

  test("rejects a map prefix with nothing after it", () => {
    expect(() => parseReference("redesign/")).toThrow(/missing a step reference/);
  });

  test("accepts a map prefix followed by a bare name, as a neutral 'bare' token", () => {
    expect(parseReference("redesign/other")).toEqual({
      kind: "bare",
      map: "redesign",
      name: "other",
    });
  });

  test("rejects a malformed name or sigil'd token", () => {
    expect(() => parseReference("Not Valid")).toThrow(WayfulError);
    expect(() => parseReference("#Not Valid")).toThrow(/step reference must be/);
  });
});

describe("expectStep", () => {
  test("accepts step forms, including a bare name", () => {
    expect(expectStep("1")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "id", id: 1 },
    });
    expect(expectStep("#research-users")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "name", name: "research-users" },
    });
    // A bare name is additive here: the `step` slot already knows it holds a
    // step, so a bare token resolves to a step name rather than erroring.
    expect(expectStep("redesign")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "name", name: "redesign" },
    });
  });

  test("accepts a map-qualified bare name as a map-qualified step name", () => {
    expect(expectStep("redesign/my-step")).toEqual({
      kind: "step",
      map: "redesign",
      token: { kind: "name", name: "my-step" },
    });
  });
});

describe("resolveToken / describeToken", () => {
  test("resolveToken finds a record by id or by name", () => {
    const records = [
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ];
    expect(resolveToken({ kind: "id", id: 2 }, records)).toEqual({ id: 2, name: "second" });
    expect(resolveToken({ kind: "name", name: "first" }, records)).toEqual({
      id: 1,
      name: "first",
    });
    expect(resolveToken({ kind: "id", id: 99 }, records)).toBeUndefined();
  });

  test("describeToken renders the id or name a user typed", () => {
    expect(describeToken({ kind: "id", id: 3 })).toBe("3");
    expect(describeToken({ kind: "name", name: "research-users" })).toBe("research-users");
  });
});

describe("assertSameMap", () => {
  test("allows an unqualified reference or one matching the current map", () => {
    expect(() => assertSameMap(undefined, "redesign", "a dependency")).not.toThrow();
    expect(() => assertSameMap("redesign", "redesign", "a dependency")).not.toThrow();
  });

  test("rejects a reference qualified with a different map", () => {
    expect(() => assertSameMap("other", "redesign", "a dependency")).toThrow(/cannot cross maps/);
  });
});
