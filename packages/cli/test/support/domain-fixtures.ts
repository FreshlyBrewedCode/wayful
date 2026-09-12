import { CURRENT_FORMAT_VERSION } from "@domain/model";
import type {
  DerivedArtifact,
  GoalRecord,
  MapMetadata,
  MapSnapshot,
  StepRecord,
  TypeDefinition,
} from "@domain/model";

// A fixed timestamp reused across fixtures: none of graph.ts, status.ts, or
// validate.ts's logic reads timestamps, so a single constant is sufficient.
export const T = "2024-01-01T00:00:00.000Z";

export function step(overrides: Partial<StepRecord> & Pick<StepRecord, "id" | "name">): StepRecord {
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

export function artifact(overrides: Partial<DerivedArtifact> = {}): DerivedArtifact {
  return {
    ref: "git:abc",
    kind: "document",
    ...overrides,
  };
}

export function goal(overrides: Partial<GoalRecord> & Pick<GoalRecord, "name">): GoalRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    description: "A goal",
    outputs: [],
    required_outputs: [],
    body: "",
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

export function typeDefinition(
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

export function map(overrides: Partial<MapMetadata> = {}): MapMetadata {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: "plan",
    start: "here",
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<MapSnapshot> = {}): MapSnapshot {
  return {
    map: map(),
    steps: [],
    artifacts: [],
    goals: [],
    types: [typeDefinition({ name: "task" })],
    ...overrides,
  };
}
