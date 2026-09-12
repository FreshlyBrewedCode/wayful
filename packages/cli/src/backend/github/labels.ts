import type { Label } from "./api";

/** The deterministic `wayful:*` label set created by `wayful init --backend github`. */
export const WAYFUL_LABELS: ReadonlyArray<Label> = [
  { name: "wayful:map", color: "1D76DB", description: "A wayful map" },
  { name: "wayful:step", color: "0E8A16", description: "A wayful step" },
  { name: "wayful:goal", color: "FBCA04", description: "A wayful goal" },
  { name: "wayful:blocked", color: "D93F0B", description: "Blocked on a dependency" },
  { name: "wayful:type/task", color: "5319E7", description: "Steps of type task" },
];
