import type { Label } from "./api";

// The primitive-kind labels. The kind lives on a label, never in the body,
// because the issue APIs can filter on labels and cannot filter on body
// content — so a label is the one place a listing can cheaply narrow itself.
export const WAYFUL_MAP_LABEL = "wayful:map";
export const WAYFUL_STEP_LABEL = "wayful:step";
export const WAYFUL_GOAL_LABEL = "wayful:goal";
export const WAYFUL_BLOCKED_LABEL = "wayful:blocked";
export const WAYFUL_TYPE_PREFIX = "wayful:type/";

/** The `wayful:type/<name>` label for a step type. */
export const wayfulTypeLabel = (name: string): string => `${WAYFUL_TYPE_PREFIX}${name}`;

/** The deterministic `wayful:*` label set created by `wayful init --backend github`. */
export const WAYFUL_LABELS: ReadonlyArray<Label> = [
  { name: WAYFUL_MAP_LABEL, color: "1D76DB", description: "A wayful map" },
  { name: WAYFUL_STEP_LABEL, color: "0E8A16", description: "A wayful step" },
  { name: WAYFUL_GOAL_LABEL, color: "FBCA04", description: "A wayful goal" },
  { name: WAYFUL_BLOCKED_LABEL, color: "D93F0B", description: "Blocked on a dependency" },
  { name: wayfulTypeLabel("task"), color: "5319E7", description: "Steps of type task" },
];
