import type { DisplayStatus, Step } from "./wayful";

/** Board column order, and the order every status legend uses. */
export const DISPLAY_STATUSES = [
  "ready",
  "pending",
  "blocked",
  "complete",
  "cancelled",
] as const satisfies readonly DisplayStatus[];

const LABELS: Record<DisplayStatus, string> = {
  ready: "ready",
  pending: "pending",
  blocked: "blocked",
  complete: "complete",
  cancelled: "cancelled",
};

export function statusLabel(status: DisplayStatus): string {
  return LABELS[status];
}

/**
 * A step's visual status. `ready` means the CLI's `map next` named this pending
 * step — the viewer derives nothing else, so it can never disagree with
 * `wayful` about where the work stands.
 */
export function displayStatus(step: Step, next: readonly number[]): DisplayStatus {
  return step.status === "pending" && next.includes(step.id) ? "ready" : step.status;
}

/** Steps bucketed by display status, with every bucket present even if empty. */
export function groupByDisplayStatus(
  steps: readonly Step[],
  next: readonly number[],
): Map<DisplayStatus, Step[]> {
  const groups = new Map<DisplayStatus, Step[]>(
    DISPLAY_STATUSES.map((status) => [status, [] as Step[]]),
  );
  for (const step of steps) groups.get(displayStatus(step, next))!.push(step);
  return groups;
}
