import { normalizedAttachments, unfulfilledSlots } from "../graph";
import type { Slot } from "../identifier";
import type { DecodeError, StepRecord } from "../model";
import { qualifiedStepId } from "./shared";

/** A step reference resolved for display: a dependency or a dependent, each carrying the current status that makes readiness visible without a second command. */
export interface StepRelationView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** A single input/output attachment: the ref it carries, and the slot or kind it names. */
export interface StepAttachmentView {
  readonly slot: string | undefined;
  readonly ref: string;
  /** Inherited from the matched required slot for slot-bound attachments; the attachment's own kind for supplementary ones. */
  readonly kind: string | undefined;
}

export interface StepContextView {
  readonly scope: "step";
  readonly map: string;
  readonly id: string;
  readonly name: string;
  readonly type: { readonly name: string; readonly description: string };
  readonly status: StepRecord["status"];
  readonly description: string;
  /** Upstream: every dependency, complete or not — see issue #8's acceptance criteria. */
  readonly dependencies: readonly StepRelationView[];
  /** Downstream: the steps that depend on this one — no existing command can answer this. */
  readonly dependents: readonly StepRelationView[];
  readonly inputs: readonly StepAttachmentView[];
  readonly outputs: {
    readonly recorded: readonly StepAttachmentView[];
    readonly unfulfilled: readonly Slot[];
  };
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | undefined;
  readonly problems: readonly DecodeError[];
}

export interface BuildStepContextOptions {
  readonly mapName: string;
  readonly step: StepRecord;
  readonly steps: readonly StepRecord[];
  /** The step's type, name and description only — step scope omits the full type instructions per the command's governing principle. */
  readonly type: { readonly name: string; readonly description: string };
  readonly problems: readonly DecodeError[];
}

/**
 * Builds step scope's derived view: connections, not contents. The body and
 * the type's full instructions are deliberately never read here — `context`
 * shows how a thing connects, `step show` shows what it says.
 */
export function buildStepContext(options: BuildStepContextOptions): StepContextView {
  const { mapName, step, steps, type, problems } = options;
  const qStep = (id: number) => qualifiedStepId(mapName, id);

  const relation = (id: number, status?: string): StepRelationView => {
    const found = steps.find((candidate) => candidate.id === id);
    return {
      id: qStep(id),
      name: found?.name ?? "(missing)",
      status: status ?? found?.status ?? "missing",
    };
  };

  const dependencies = step.dependencies.map((id) => relation(id));
  const dependents = steps
    .filter((candidate) => candidate.dependencies.includes(step.id))
    .toSorted((a, b) => a.id - b.id)
    .map((candidate) => relation(candidate.id, candidate.status));

  const toAttachmentView =
    (direction: "inputs" | "outputs") =>
    (attachment: {
      readonly slot: string | undefined;
      readonly ref: string;
      readonly kind: string | undefined;
    }): StepAttachmentView => {
      const required = direction === "inputs" ? step.required_inputs : step.required_outputs;
      const slotKind = required.find((candidate) => candidate.name === attachment.slot)?.kind;
      return { slot: attachment.slot, ref: attachment.ref, kind: attachment.kind ?? slotKind };
    };

  return {
    scope: "step",
    map: mapName,
    id: qStep(step.id),
    name: step.name,
    type,
    status: step.status,
    description: step.description,
    dependencies,
    dependents,
    inputs: normalizedAttachments(step.inputs).map(toAttachmentView("inputs")),
    outputs: {
      recorded: normalizedAttachments(step.outputs).map(toAttachmentView("outputs")),
      unfulfilled: unfulfilledSlots(step.required_outputs, step.outputs),
    },
    created_at: step.created_at,
    updated_at: step.updated_at,
    closed_at: step.closed_at,
    problems,
  };
}
