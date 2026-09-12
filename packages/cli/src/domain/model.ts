import type { Slot } from "./identifier";

/** The on-disk schema version every record in this codebase reads and writes. */
export const CURRENT_FORMAT_VERSION = 4;

export type ProjectBackend = "filesystem" | "github";

export interface ProjectMetadata {
  readonly format_version: number;
  readonly description: string;
  /** Defaults to "filesystem" when absent, so existing project.toml files keep decoding. */
  readonly backend: ProjectBackend;
  /** Only present (and required) when `backend` is "github"; `owner/name`. */
  readonly repo?: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MapMetadata {
  readonly format_version: number;
  readonly name: string;
  readonly start: string;
  readonly allowed_step_types?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A step attachment carries a ref directly (ADR-0004), in one of two
 * mutually-exclusive shapes: slot-bound (kind inherited from the step's
 * required slot) or supplementary (names its own kind, no slot).
 */
export type Attachment =
  | { readonly slot: string; readonly ref: string }
  | { readonly ref: string; readonly kind: string };

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

/** The shape the CLI hands the backend when creating a step; id and timestamps are backend-sourced. */
export type NewStepRecord = Omit<StepRecord, "id" | "created_at" | "updated_at" | "closed_at">;

/**
 * An artifact: a unique ref attached as a step input/output or a goal
 * output somewhere in the map. There is no stored record (ADR-0004) — this
 * is always derived from the attachments that carry the ref, by
 * `domain/graph.ts`'s `deriveArtifacts`.
 */
export interface DerivedArtifact {
  readonly ref: string;
  readonly kind: string;
}

export interface GoalRecord {
  readonly format_version: number;
  readonly name: string;
  readonly description: string;
  // Decoding only checks these are arrays; each entry's shape is diagnosed by
  // domain/graph.ts's attachmentErrors, so manually-authored malformed entries
  // survive decoding to be reported.
  readonly outputs: readonly unknown[];
  readonly required_outputs: readonly Slot[];
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
  readonly artifacts: readonly DerivedArtifact[];
  readonly goals: readonly GoalRecord[];
  readonly types: readonly TypeDefinition[];
}

/** A single record within a collection that failed to decode, and why. */
export interface DecodeError {
  /** The record's filename, relative to its own collection directory. */
  readonly file: string;
  readonly message: string;
}

/**
 * The shape every filesystem-backend collection read returns: the records
 * that decoded successfully, together with the ones that didn't. A broken
 * sibling never hides a healthy one — callers that need the old
 * abort-on-first-failure behaviour instead can fold this back with
 * `scope.ts`'s `strict()`.
 */
export interface CollectionRead<T> {
  readonly records: readonly T[];
  readonly errors: readonly DecodeError[];
}
