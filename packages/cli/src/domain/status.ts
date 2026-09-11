import { attachmentOK, nextSteps } from "./graph";
import type { GoalRecord, MapMetadata, StepRecord } from "./model";

export interface StepCounts {
  readonly pending: number;
  readonly blocked: number;
  readonly complete: number;
  readonly cancelled: number;
}

export interface Blocker {
  readonly id: number;
  readonly name: string;
  readonly reason: string | undefined;
}

export interface MapStatus {
  readonly map: string;
  readonly goals: { readonly satisfied: number; readonly total: number };
  readonly steps: StepCounts;
  readonly blockers: readonly Blocker[];
  readonly next: readonly { readonly id: number; readonly name: string }[];
}

export function mapStatus(
  map: MapMetadata,
  steps: readonly StepRecord[],
  goals: readonly GoalRecord[],
): MapStatus {
  const next = nextSteps(steps);
  const counts: StepCounts = {
    pending: steps.filter((step) => step.status === "pending").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
    complete: steps.filter((step) => step.status === "complete").length,
    cancelled: steps.filter((step) => step.status === "cancelled").length,
  };
  const blockers = steps
    .filter((step) => step.status === "blocked")
    .map((step) => ({ id: step.id, name: step.name, reason: step.block_reason }));
  return {
    map: map.name,
    goals: {
      satisfied: goals.filter((goal) => attachmentOK(goal.required_outputs, goal.outputs)).length,
      total: goals.length,
    },
    steps: counts,
    blockers,
    next: next.map((step) => ({ id: step.id, name: step.name })),
  };
}
