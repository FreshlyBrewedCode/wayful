import { attachmentOK } from "../graph";
import type { DecodeError, GoalRecord, MapMetadata, StepRecord } from "../model";
import type { StepCounts } from "../status";

export interface ProjectMapSummary {
  readonly map: string;
  readonly start: string;
  readonly goals: { readonly satisfied: number; readonly total: number };
  readonly steps: StepCounts;
  /** The maximum `updated_at` over the map's steps and goals — never stored, always derived. Artifacts carry no timestamp of their own (ADR-0004). */
  readonly lastActivity: string | undefined;
}

/** Summarizes one map for project scope: start, goal/step progress, and derived last activity. */
export function summarizeProjectMap(
  metadata: MapMetadata,
  steps: readonly StepRecord[],
  goals: readonly GoalRecord[],
): ProjectMapSummary {
  const timestamps = [
    ...steps.map((step) => step.updated_at),
    ...goals.map((goal) => goal.updated_at),
  ];
  const lastActivity = timestamps.length
    ? timestamps.reduce((max, at) => (at > max ? at : max))
    : undefined;
  return {
    map: metadata.name,
    start: metadata.start,
    goals: {
      satisfied: goals.filter((goal) => attachmentOK(goal.required_outputs, goal.outputs)).length,
      total: goals.length,
    },
    steps: {
      pending: steps.filter((step) => step.status === "pending").length,
      blocked: steps.filter((step) => step.status === "blocked").length,
      complete: steps.filter((step) => step.status === "complete").length,
      cancelled: steps.filter((step) => step.status === "cancelled").length,
    },
    lastActivity,
  };
}

/** Orders maps by last activity descending, ties broken by name, maps with no activity last. */
export function orderProjectMaps(summaries: readonly ProjectMapSummary[]): ProjectMapSummary[] {
  return summaries.toSorted((a, b) => {
    if (a.lastActivity === undefined && b.lastActivity === undefined)
      return a.map.localeCompare(b.map);
    if (a.lastActivity === undefined) return 1;
    if (b.lastActivity === undefined) return -1;
    if (a.lastActivity !== b.lastActivity) return a.lastActivity < b.lastActivity ? 1 : -1;
    return a.map.localeCompare(b.map);
  });
}

export interface ProjectContextView {
  readonly scope: "project";
  readonly project: { readonly description: string; readonly root: string };
  readonly maps: readonly ProjectMapSummary[];
  readonly types: readonly { readonly name: string; readonly description: string }[];
  readonly problems: readonly DecodeError[];
}
