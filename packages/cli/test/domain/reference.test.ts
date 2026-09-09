import { describe, expect, test } from "bun:test";

import { WayfulError } from "../../src/domain/errors";
import {
  assertSameMap,
  describeToken,
  expectArtifact,
  expectStep,
  parseReference,
  resolveToken,
} from "../../src/domain/reference";

describe("parseReference", () => {
  test("resolves a bare integer to a step id, unqualified", () => {
    expect(parseReference("1")).toEqual({
      kind: "step",
      map: undefined,
      token: { kind: "id", id: 1 },
    });
  });

  test("resolves a bare kebab-case name to a neutral 'bare' token, unqualified", () => {
    // The grammar is additive: a bare name is inherently ambiguous (map, step,
    // or artifact) outside a sigil, so parseReference itself stays agnostic
    // and leaves the call site to decide (see expectStep / expectArtifact
    // below, and the future polymorphic slot this leaves room for).
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

  test("resolves '@id' and '@name' to an artifact by id or by name", () => {
    expect(parseReference("@5")).toEqual({
      kind: "artifact",
      map: undefined,
      token: { kind: "id", id: 5 },
    });
    expect(parseReference("@user-interviews")).toEqual({
      kind: "artifact",
      map: undefined,
      token: { kind: "name", name: "user-interviews" },
    });
  });

  test("accepts a map prefix on the bare-integer, '#', and '@' forms", () => {
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
    expect(parseReference("redesign/@5")).toEqual({
      kind: "artifact",
      map: "redesign",
      token: { kind: "id", id: 5 },
    });
    expect(parseReference("redesign/@user-interviews")).toEqual({
      kind: "artifact",
      map: "redesign",
      token: { kind: "name", name: "user-interviews" },
    });
  });

  test("rejects an empty reference", () => {
    expect(() => parseReference("")).toThrow(WayfulError);
    expect(() => parseReference("   ")).toThrow(/must not be empty/);
  });

  test("rejects an unrecognized sigil", () => {
    expect(() => parseReference("%5")).toThrow(/not a recognized reference sigil/);
    expect(() => parseReference("!research")).toThrow(/not a recognized reference sigil/);
  });

  test("rejects an invalid or numeric map prefix", () => {
    expect(() => parseReference("Redesign/#1")).toThrow(/invalid map prefix/);
    expect(() => parseReference("123/#1")).toThrow(/invalid map prefix/);
  });

  test("rejects a map prefix with nothing after it", () => {
    expect(() => parseReference("redesign/")).toThrow(/missing a step or artifact reference/);
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
    expect(() => parseReference("@Not Valid")).toThrow(/artifact reference must be/);
  });
});

describe("expectStep / expectArtifact", () => {
  test("expectStep accepts step forms, including a bare name, and rejects artifact forms", () => {
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
    expect(() => expectStep("@5")).toThrow(/references an artifact/);
  });

  test("expectStep accepts a map-qualified bare name as a map-qualified step name", () => {
    expect(expectStep("redesign/my-step")).toEqual({
      kind: "step",
      map: "redesign",
      token: { kind: "name", name: "my-step" },
    });
  });

  test("expectArtifact accepts artifact forms, including a bare name, and rejects step forms", () => {
    expect(expectArtifact("@5")).toEqual({
      kind: "artifact",
      map: undefined,
      token: { kind: "id", id: 5 },
    });
    // A bare name is additive here too: the `artifact`/`evidence` slot already
    // knows it holds an artifact.
    expect(expectArtifact("redesign")).toEqual({
      kind: "artifact",
      map: undefined,
      token: { kind: "name", name: "redesign" },
    });
    // Bare integers stay exclusively steps (the shell-comment hazard '#'
    // sidesteps): an artifact has no bare-id form.
    expect(() => expectArtifact("1")).toThrow(/does not reference an artifact/);
  });

  test("expectArtifact accepts a map-qualified bare name as a map-qualified artifact name", () => {
    expect(expectArtifact("redesign/my-artifact")).toEqual({
      kind: "artifact",
      map: "redesign",
      token: { kind: "name", name: "my-artifact" },
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
