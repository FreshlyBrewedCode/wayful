import type { Slot } from "./identifier";

export interface ProjectMetadata {
  readonly format_version: number;
  readonly description: string;
}

export interface MapMetadata {
  readonly format_version: number;
  readonly name: string;
  readonly start: string;
  readonly step_id_counter: number;
  readonly allowed_step_types?: readonly string[];
}

export interface Attachment {
  readonly artifact: string;
  readonly slot?: string;
}

export type StepStatus = "pending" | "blocked" | "complete" | "cancelled";

export interface StepRecord {
  readonly format_version: number;
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly status: StepStatus;
  readonly dependencies: readonly number[];
  // Decoding only checks these are arrays; each entry's shape is diagnosed by
  // domain/graph.ts's attachmentErrors, so manually-authored malformed entries
  // (missing artifact, non-string slot, ...) survive decoding to be reported.
  readonly inputs: readonly unknown[];
  readonly outputs: readonly unknown[];
  readonly required_inputs: readonly Slot[];
  readonly required_outputs: readonly Slot[];
  readonly body: string;
  readonly completion_summary?: string;
  readonly cancellation_reason?: string;
  readonly block_reason?: string;
}

export interface ArtifactRecord {
  readonly format_version: number;
  readonly name: string;
  readonly kind: string;
  readonly ref: string;
}

export interface GoalRecord {
  readonly format_version: number;
  readonly name: string;
  readonly description: string;
  readonly evidence: readonly string[];
  readonly body: string;
}

export interface TypeDefinition {
  readonly format_version: number;
  readonly name: string;
  readonly description: string;
  readonly required_inputs: readonly Slot[];
  readonly required_outputs: readonly Slot[];
  readonly instructions: string;
}

export interface MapSnapshot {
  readonly map: MapMetadata;
  readonly steps: readonly StepRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly goals: readonly GoalRecord[];
  readonly types: readonly TypeDefinition[];
}
