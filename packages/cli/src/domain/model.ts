import type { Slot } from "./identifier";

/** The on-disk schema version every record in this codebase reads and writes. */
export const CURRENT_FORMAT_VERSION = 2;

export interface ProjectMetadata {
  readonly format_version: number;
  readonly description: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MapMetadata {
  readonly format_version: number;
  readonly name: string;
  readonly start: string;
  readonly step_id_counter: number;
  readonly artifact_id_counter: number;
  readonly allowed_step_types?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Attachment {
  readonly artifact: string;
  readonly slot?: string;
}

export type StepStatus = "pending" | "blocked" | "complete" | "cancelled";

/** A step in either of these statuses is terminal: it carries `closed_at` and rejects further edits. */
export const closesStep = (status: StepStatus): boolean =>
  status === "complete" || status === "cancelled";

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
  readonly created_at: string;
  readonly updated_at: string;
  /** Set when the step transitions to `complete` or `cancelled`; absent otherwise. */
  readonly closed_at?: string;
}

/** The shape the CLI hands the backend when creating a step; timestamps are backend-sourced. */
export type NewStepRecord = Omit<StepRecord, "created_at" | "updated_at" | "closed_at">;

export interface ArtifactRecord {
  readonly format_version: number;
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly ref: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The shape the CLI hands the backend when creating an artifact; timestamps are backend-sourced. */
export type NewArtifactRecord = Omit<ArtifactRecord, "created_at" | "updated_at">;

export interface GoalRecord {
  readonly format_version: number;
  readonly name: string;
  readonly description: string;
  readonly evidence: readonly string[];
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The shape the CLI hands the backend when creating a goal; timestamps are backend-sourced. */
export type NewGoalRecord = Omit<GoalRecord, "created_at" | "updated_at">;

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
