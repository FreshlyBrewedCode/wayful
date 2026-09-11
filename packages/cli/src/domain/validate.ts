import { attachmentErrors, attachmentOK, hasDependencyCycle } from "./graph";
import type { MapSnapshot } from "./model";

export function validateMap(
  snapshot: MapSnapshot,
  options: { readonly includeProgress?: boolean } = {},
): string[] {
  const includeProgress = options.includeProgress ?? true;
  const { map, steps, goals, types } = snapshot;
  const errors: string[] = [];

  const names = new Set<string>();
  const ids = new Set<number>();
  for (const step of steps) {
    if (names.has(step.name) || ids.has(step.id)) errors.push("duplicate step identity.");
    names.add(step.name);
    ids.add(step.id);

    const type = types.find((candidate) => candidate.name === step.type);
    if (!type) errors.push(`type '${step.type}' does not exist.`);
    else if (map.allowed_step_types && !map.allowed_step_types.includes(step.type))
      errors.push(`step '${step.name}' has a disallowed type.`);

    const dependencyIDs = new Set<number>();
    for (const id of step.dependencies) {
      if (dependencyIDs.has(id)) errors.push(`step '${step.name}' has a duplicate dependency.`);
      dependencyIDs.add(id);
      const dependency = steps.find((candidate) => candidate.id === id);
      if (!dependency) errors.push(`step '${step.name}' has a missing dependency.`);
      else if (dependency.status === "cancelled")
        errors.push(`step '${step.name}' depends on cancelled step '${dependency.name}'.`);
    }

    for (const direction of ["inputs", "outputs"] as const)
      errors.push(
        ...attachmentErrors(
          direction === "inputs" ? step.required_inputs : step.required_outputs,
          step[direction],
          `step '${step.name}'`,
          direction,
        ),
      );

    if (includeProgress && !attachmentOK(step.required_inputs, step.inputs))
      errors.push(`step '${step.name}' has unmet required inputs.`);
    if (step.status === "complete" && !attachmentOK(step.required_outputs, step.outputs))
      errors.push(`completed step '${step.name}' has unmet required outputs.`);
    if (includeProgress && step.status === "blocked")
      errors.push(`step '${step.name}' is blocked.`);
    if (includeProgress && step.status === "pending")
      errors.push(`step '${step.name}' remains pending.`);
  }

  if (hasDependencyCycle(steps)) errors.push("dependency cycle detected.");

  for (const goal of goals) {
    errors.push(
      ...attachmentErrors(goal.required_outputs, goal.outputs, `goal '${goal.name}'`, "outputs"),
    );
    if (includeProgress && !attachmentOK(goal.required_outputs, goal.outputs))
      errors.push(`goal '${goal.name}' is not satisfied.`);
  }

  return [...new Set(errors)];
}
