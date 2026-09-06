import type { MapDetail, Step, StepStatus, WayfulMap } from "@/lib/wayful";

/** A step with only the fields a test cares about spelled out. */
export function step(id: number, overrides: Partial<Step> & { status?: StepStatus } = {}): Step {
  return {
    id,
    name: `step-${id}`,
    type: "task",
    description: `Step ${id}`,
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [],
    required_outputs: [],
    body: "",
    ...overrides,
  };
}

export function map(steps: Step[], overrides: Partial<WayfulMap> = {}): WayfulMap {
  return {
    name: "demo",
    start: "Somewhere",
    goals: [{ name: "initial-goal", description: "Get there", evidence: [], body: "" }],
    artifacts: [],
    steps,
    ...overrides,
  };
}

export function detail(steps: Step[], next: number[] = []): MapDetail {
  const counts: Record<string, number> = {};
  for (const s of steps) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const m = map(steps);
  return {
    map: m,
    status: {
      map: m.name,
      goals: { satisfied: 0, total: m.goals.length },
      steps: counts,
      blockers: steps
        .filter((s) => s.status === "blocked")
        .map((s) => ({ id: s.id, name: s.name, reason: s.block_reason })),
      next: steps.filter((s) => next.includes(s.id)).map((s) => ({ id: s.id, name: s.name })),
    },
    next,
    validation: { valid: false, errors: ["goal 'initial-goal' is not satisfied."] },
  };
}
