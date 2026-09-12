import type { Label } from "@backend/github/api";

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

/** The label a step type needs on demand; types are hand-maintained files on disk. */
export const wayfulTypeLabelDefinition = (name: string): Label => ({
  name: wayfulTypeLabel(name),
  color: "5319E7",
  description: `Steps of type ${name}`,
});

// The primitive-kind labels are fixed; type labels follow the type files, which
// are hand-maintained, so `wayfulLabels` is the ongoing sync, not a bootstrap.
const BASE_WAYFUL_LABELS: ReadonlyArray<Label> = [
  { name: WAYFUL_MAP_LABEL, color: "1D76DB", description: "A wayful map" },
  { name: WAYFUL_STEP_LABEL, color: "0E8A16", description: "A wayful step" },
  { name: WAYFUL_GOAL_LABEL, color: "FBCA04", description: "A wayful goal" },
  { name: WAYFUL_BLOCKED_LABEL, color: "D93F0B", description: "Blocked on a dependency" },
];

/**
 * Every `wayful:*` label a project should carry: the fixed primitive labels plus
 * one `wayful:type/<name>` per type file. Re-runnable — the type set is the
 * hand-maintained type files, which can gain a member at any time.
 */
export function wayfulLabels(typeNames: readonly string[]): ReadonlyArray<Label> {
  const seen = new Set<string>();
  return [...BASE_WAYFUL_LABELS, ...typeNames.map(wayfulTypeLabelDefinition)].filter((label) => {
    if (seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

/** The label set `wayful init --backend github` bootstraps, when types may not exist yet. */
export const WAYFUL_LABELS: ReadonlyArray<Label> = wayfulLabels(["task"]);
