// The shapes the Wayful CLI emits with `--json`, transcribed. Nothing here is
// derived: if a field is not in the CLI's output it does not exist in the
// viewer either, which is what keeps the viewer from disagreeing with `wayful`.

/** The four statuses Wayful persists. */
export type StepStatus = "pending" | "blocked" | "complete" | "cancelled";

/**
 * What a step looks like on screen. `ready` is display-only: a pending step the
 * CLI listed in `map next`. It is never persisted.
 */
export type DisplayStatus = StepStatus | "ready";

export interface Slot {
  name: string;
  kind: string;
  description?: string;
}

export type Attachment = { slot: string; ref: string } | { ref: string; kind: string };

export interface Step {
  id: number;
  name: string;
  type: string;
  description: string;
  status: StepStatus;
  dependencies: number[];
  inputs: Attachment[];
  outputs: Attachment[];
  required_inputs: Slot[];
  required_outputs: Slot[];
  body?: string;
  block_reason?: string;
  cancellation_reason?: string;
  completion_summary?: string;
}

/** `step show` adds the body and the instructions resolved live from the type. */
export interface StepDetail extends Step {
  body: string;
  instructions: string;
}

export interface Goal {
  name: string;
  description: string;
  evidence: string[];
  body: string;
}

export interface Artifact {
  name: string;
  kind: string;
  ref: string;
}

export interface WayfulMap {
  name: string;
  start: string;
  goals: Goal[];
  artifacts: Artifact[];
  steps: Step[];
}

export interface Blocker {
  id: number;
  name: string;
  reason?: string;
}

export interface MapStatus {
  map: string;
  goals: { satisfied: number; total: number };
  steps: Partial<Record<StepStatus, number>>;
  blockers: Blocker[];
  next: { id: number; name: string }[];
}

export interface Validation {
  valid: boolean;
  errors: string[];
}

export interface StepType {
  name: string;
  description: string;
  required_inputs: Slot[];
  required_outputs: Slot[];
  instructions: string;
}

export interface MapSummary {
  name: string;
  start: string;
  status: MapStatus | null;
}

export interface ProjectMeta {
  root: string;
  description: string;
  error?: string;
}

/** `GET /api/overview` — the project and every map's status summary. */
export interface Overview {
  project: ProjectMeta;
  maps: MapSummary[];
  types: StepType[];
  error?: string;
}

/** `GET /api/map` — show/status/next/validate composed into one round trip. */
export interface MapDetail {
  map: WayfulMap;
  status: MapStatus | null;
  next: number[];
  validation: Validation | null;
}

/** A map that could not be read reports the CLI's own message. */
export interface MapError {
  error: string;
}

export type MapResponse = MapDetail | MapError;
export type StepResponse = StepDetail | MapError;

export function isError<T extends object>(value: T | MapError): value is MapError {
  return "error" in value && typeof (value as MapError).error === "string";
}
