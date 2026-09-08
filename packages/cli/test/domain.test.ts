import { describe, expect, test } from "bun:test";

import { WayfulError } from "../src/domain/errors";
import {
  attachmentErrors,
  attachmentOK,
  dependenciesOK,
  hasDependencyCycle,
  nextSteps,
  reaches,
} from "../src/domain/graph";
import { CURRENT_FORMAT_VERSION } from "../src/domain/model";
import { formatVersion, identifier, nonEmpty, slots } from "../src/domain/identifier";
import type {
  ArtifactRecord,
  MapMetadata,
  MapSnapshot,
  StepRecord,
  TypeDefinition,
} from "../src/domain/model";
import {
  assertSameMap,
  describeToken,
  expectArtifact,
  expectStep,
  parseReference,
  resolveToken,
} from "../src/domain/reference";
import { mapStatus } from "../src/domain/status";
import { validateMap } from "../src/domain/validate";

// A fixed timestamp reused across fixtures: none of graph.ts, status.ts, or
// validate.ts's logic reads timestamps, so a single constant is sufficient.
const T = "2024-01-01T00:00:00.000Z";

function step(overrides: Partial<StepRecord> & Pick<StepRecord, "id" | "name">): StepRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    type: "task",
    description: "A step",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [],
    required_outputs: [],
    body: "",
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

function artifact(
  overrides: Partial<ArtifactRecord> & Pick<ArtifactRecord, "name">,
): ArtifactRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    id: 1,
    kind: "document",
    ref: "git:abc",
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

function typeDefinition(
  overrides: Partial<TypeDefinition> & Pick<TypeDefinition, "name">,
): TypeDefinition {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    description: "A type",
    required_inputs: [],
    required_outputs: [],
    instructions: "",
    ...overrides,
  };
}

function map(overrides: Partial<MapMetadata> & Pick<MapMetadata, "step_id_counter">): MapMetadata {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: "plan",
    start: "here",
    artifact_id_counter: 1,
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MapSnapshot> = {}): MapSnapshot {
  return {
    map: map({ step_id_counter: 1 }),
    steps: [],
    artifacts: [],
    goals: [],
    types: [typeDefinition({ name: "task" })],
    ...overrides,
  };
}

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

describe("graph", () => {
  test("attachmentOK is true only when every required slot has a correctly-kinded attachment", () => {
    const required = [{ name: "brief", kind: "document" }];
    const withMatch = step({
      id: 1,
      name: "work",
      required_inputs: required,
      inputs: [{ artifact: "proof", slot: "brief" }],
    });
    const withoutMatch = step({ id: 1, name: "work", required_inputs: required, inputs: [] });
    const artifacts = [artifact({ name: "proof", kind: "document" })];
    expect(attachmentOK(withMatch, "inputs", artifacts)).toBe(true);
    expect(attachmentOK(withoutMatch, "inputs", artifacts)).toBe(false);
  });

  test("attachmentErrors reports missing artifacts, unknown slots, duplicate fulfillment, and kind mismatches", () => {
    const required = [{ name: "source", kind: "document" }];
    const artifacts = [
      artifact({ name: "document", kind: "document" }),
      artifact({ name: "image", kind: "image" }),
    ];

    expect(
      attachmentErrors(
        step({
          id: 1,
          name: "missing",
          required_inputs: required,
          inputs: [{ artifact: "absent" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'missing' has a missing inputs artifact 'absent'."]);

    expect(
      attachmentErrors(
        step({
          id: 2,
          name: "unknown",
          required_inputs: required,
          inputs: [{ artifact: "document", slot: "absent" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'unknown' has an unknown inputs slot 'absent'."]);

    expect(
      attachmentErrors(
        step({
          id: 3,
          name: "duplicate",
          required_inputs: required,
          inputs: [
            { artifact: "document", slot: "source" },
            { artifact: "document", slot: "source" },
          ],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'duplicate' fulfills inputs slot 'source' more than once."]);

    expect(
      attachmentErrors(
        step({
          id: 4,
          name: "wrong-kind",
          required_inputs: required,
          inputs: [{ artifact: "image", slot: "source" }],
        }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'wrong-kind' attaches wrong artifact kind to inputs slot 'source'."]);

    expect(
      attachmentErrors(
        step({ id: 5, name: "null-attachment", required_inputs: required, inputs: [null] }),
        "inputs",
        artifacts,
      ),
    ).toEqual(["step 'null-attachment' has an invalid inputs attachment."]);
  });

  test("dependenciesOK requires every dependency to be complete", () => {
    const steps = [
      step({ id: 1, name: "a", status: "complete" }),
      step({ id: 2, name: "b", status: "pending" }),
    ];
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [1] }), steps)).toBe(true);
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [2] }), steps)).toBe(false);
    expect(dependenciesOK(step({ id: 3, name: "c", dependencies: [99] }), steps)).toBe(false);
  });

  test("nextSteps returns pending, actionable steps sorted by ID", () => {
    const steps = [
      step({ id: 2, name: "later" }),
      step({ id: 1, name: "first" }),
      step({ id: 3, name: "blocked-dep", dependencies: [1] }),
      step({ id: 4, name: "not-pending", status: "complete" }),
    ];
    const result = nextSteps(steps, []);
    expect(result.map((s) => s.name)).toEqual(["first", "later"]);
  });

  test("reaches detects whether a dependency chain reaches a target ID", () => {
    const steps = [
      step({ id: 1, name: "a" }),
      step({ id: 2, name: "b", dependencies: [1] }),
      step({ id: 3, name: "c", dependencies: [2] }),
    ];
    expect(reaches(steps, 3, 1)).toBe(true);
    expect(reaches(steps, 1, 3)).toBe(false);
    expect(reaches(steps, 1, 1)).toBe(true);
  });

  test("hasDependencyCycle detects cycles but not acyclic graphs", () => {
    const acyclic = [step({ id: 1, name: "a" }), step({ id: 2, name: "b", dependencies: [1] })];
    expect(hasDependencyCycle(acyclic)).toBe(false);
    const cyclic = [
      step({ id: 1, name: "a", dependencies: [2] }),
      step({ id: 2, name: "b", dependencies: [1] }),
    ];
    expect(hasDependencyCycle(cyclic)).toBe(true);
  });
});

describe("validateMap", () => {
  test("returns no errors for a coherent, fully-satisfied map", () => {
    const steps = [step({ id: 1, name: "work", status: "complete", completion_summary: "done" })];
    const snap = snapshot({
      map: map({ step_id_counter: 2 }),
      steps,
    });
    expect(validateMap(snap)).toEqual([]);
  });

  test("flags an incoherent step_id_counter", () => {
    const snap = snapshot({
      map: map({ step_id_counter: 1 }),
      steps: [step({ id: 1, name: "work", status: "complete", completion_summary: "done" })],
    });
    expect(validateMap(snap)).toContain(
      "map step_id_counter must be greater than every existing step ID.",
    );
  });

  test("flags duplicate step identity and duplicate artifact identity", () => {
    const snap = snapshot({
      map: map({ step_id_counter: 3 }),
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
      map: map({ step_id_counter: 2, allowed_step_types: ["other"] }),
      steps: [
        step({ id: 1, name: "work", type: "task", status: "complete", completion_summary: "done" }),
      ],
    });
    expect(validateMap(disallowed)).toContain("step 'work' has a disallowed type.");
  });

  test("flags missing, duplicate, and cancelled-prerequisite dependencies", () => {
    const missing = snapshot({
      map: map({ step_id_counter: 2 }),
      steps: [step({ id: 1, name: "a", dependencies: [99] })],
    });
    expect(validateMap(missing, { includeProgress: false })).toContain(
      "step 'a' has a missing dependency.",
    );

    const duplicate = snapshot({
      map: map({ step_id_counter: 3 }),
      steps: [
        step({ id: 1, name: "a", status: "complete", completion_summary: "done" }),
        step({ id: 2, name: "b", dependencies: [1, 1] }),
      ],
    });
    expect(validateMap(duplicate, { includeProgress: false })).toContain(
      "step 'b' has a duplicate dependency.",
    );

    const cancelled = snapshot({
      map: map({ step_id_counter: 3 }),
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
      map: map({ step_id_counter: 2 }),
      steps: [step({ id: 1, name: "work", required_inputs: requiredInputs })],
    });
    expect(validateMap(missingInput)).toContain("step 'work' has unmet required inputs.");
    expect(validateMap(missingInput, { includeProgress: false })).not.toContain(
      "step 'work' has unmet required inputs.",
    );

    const requiredOutputs = [{ name: "report", kind: "document" }];
    const missingOutput = snapshot({
      map: map({ step_id_counter: 2 }),
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
      map: map({ step_id_counter: 3 }),
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
      map: map({ step_id_counter: 3 }),
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
