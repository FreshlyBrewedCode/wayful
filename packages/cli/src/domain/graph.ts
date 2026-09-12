import type { Slot } from "@domain/identifier";
import type { DerivedArtifact, GoalRecord, StepRecord } from "@domain/model";

/** A single valid attachment, normalized out of a step's raw `inputs`/`outputs`. */
export interface AttachmentView {
  readonly slot: string | undefined;
  readonly ref: string;
  /** Set only for supplementary attachments; slot-bound attachments inherit kind from the slot. */
  readonly kind: string | undefined;
}

/**
 * Normalizes a step's raw `inputs`/`outputs` into the attachments that decode
 * validly, silently dropping malformed entries — `attachmentErrors` below is
 * what reports those, for `map validate`. Used by `context` step and
 * artifact scope to read attachments without re-deriving their shape, and to
 * build the artifact reverse index.
 */
export function normalizedAttachments(attachments: readonly unknown[]): readonly AttachmentView[] {
  const result: AttachmentView[] = [];
  for (const candidate of attachments) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const c = candidate as Record<string, unknown>;
    if (typeof c.ref !== "string") continue;
    const hasSlot = typeof c.slot === "string";
    const hasKind = typeof c.kind === "string";
    if (hasSlot === hasKind) continue; // exactly one of slot/kind required
    result.push({
      ref: c.ref,
      slot: hasSlot ? (c.slot as string) : undefined,
      kind: hasKind ? (c.kind as string) : undefined,
    });
  }
  return result;
}

/** Whether a required slot is filled by a slot-bound attachment naming it. */
function slotFulfilled(slot: Slot, attachments: readonly unknown[]): boolean {
  return normalizedAttachments(attachments).some((a) => a.slot === slot.name);
}

/**
 * The required slots that are not yet fulfilled by `attachments` — the
 * per-slot detail `attachmentOK` collapses into a single boolean. Used by
 * `context` map scope to explain *which* input a pending-not-actionable step
 * is still missing, and generalizes to a goal's required outputs.
 */
export function unfulfilledSlots(
  required: readonly Slot[],
  attachments: readonly unknown[],
): Slot[] {
  return required.filter((slot) => !slotFulfilled(slot, attachments));
}

export function attachmentOK(required: readonly Slot[], attachments: readonly unknown[]): boolean {
  return required.every((slot) => slotFulfilled(slot, attachments));
}

/**
 * `subject` and `direction` name what's being checked in the error text
 * (e.g. `step 'x'` / `"inputs"`, or `goal 'y'` / `"outputs"`) — the check
 * itself has no notion of steps or goals, only slots and attachments.
 */
export function attachmentErrors(
  required: readonly Slot[],
  attachments: readonly unknown[],
  subject: string,
  direction: string,
): string[] {
  const errors: string[] = [];
  const slotsSeen = new Set<string>();
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      errors.push(`${subject} has an invalid ${direction} attachment.`);
      continue;
    }
    const a = attachment as Record<string, unknown>;
    if (typeof a.ref !== "string") {
      errors.push(`${subject} has an invalid ${direction} attachment.`);
      continue;
    }
    const hasSlot = typeof a.slot === "string";
    const hasKind = typeof a.kind === "string";
    if (hasSlot === hasKind) {
      errors.push(`${subject} has an invalid ${direction} attachment.`);
      continue;
    }
    if (!hasSlot) continue; // supplementary: no further checks
    const slotName = a.slot as string;
    const slot = required.find((candidate) => candidate.name === slotName);
    if (!slot) {
      errors.push(`${subject} has an unknown ${direction} slot '${slotName}'.`);
      continue;
    }
    if (slotsSeen.has(slotName))
      errors.push(`${subject} fulfills ${direction} slot '${slotName}' more than once.`);
    slotsSeen.add(slotName);
  }
  return errors;
}

/**
 * Derives the map's artifacts (ADR-0004: a ref is never stored on its own)
 * as the unique refs attached across every step's inputs/outputs and every
 * goal's outputs, each paired with its kind — inherited from the slot for a
 * slot-bound attachment, or named directly for a supplementary one. A ref
 * seen more than once keeps the kind of its first occurrence.
 */
export function deriveArtifacts(
  steps: readonly StepRecord[],
  goals: readonly GoalRecord[],
): DerivedArtifact[] {
  const kinds = new Map<string, string>();
  const record = (attachments: readonly unknown[], requiredSlots: readonly Slot[]) => {
    for (const attachment of normalizedAttachments(attachments)) {
      if (kinds.has(attachment.ref)) continue;
      const kind =
        attachment.kind ?? requiredSlots.find((slot) => slot.name === attachment.slot)?.kind;
      if (kind !== undefined) kinds.set(attachment.ref, kind);
    }
  };
  for (const step of steps) {
    record(step.inputs, step.required_inputs);
    record(step.outputs, step.required_outputs);
  }
  for (const goal of goals) record(goal.outputs, goal.required_outputs);
  return [...kinds.entries()]
    .map(([ref, kind]) => ({ ref, kind }))
    .toSorted((a, b) => a.ref.localeCompare(b.ref));
}

export function dependenciesOK(step: StepRecord, steps: readonly StepRecord[]): boolean {
  return step.dependencies.every((id) => steps.find((s) => s.id === id)?.status === "complete");
}

export function nextSteps(steps: readonly StepRecord[]): StepRecord[] {
  return steps
    .filter(
      (step) =>
        step.status === "pending" &&
        dependenciesOK(step, steps) &&
        attachmentOK(step.required_inputs, step.inputs),
    )
    .toSorted((a, b) => a.id - b.id);
}

/** Whether `fromId`'s dependency chain reaches `toId` (including fromId === toId). */
export function reaches(
  steps: readonly StepRecord[],
  fromId: number,
  toId: number,
  seen: Set<number> = new Set(),
): boolean {
  if (fromId === toId) return true;
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const node = steps.find((s) => s.id === fromId);
  if (!node) return false;
  return node.dependencies.some((dependencyID) => reaches(steps, dependencyID, toId, seen));
}

export function hasDependencyCycle(steps: readonly StepRecord[]): boolean {
  const visit = (step: StepRecord, seen: Set<number>, stack: Set<number>): boolean => {
    if (stack.has(step.id)) return true;
    if (seen.has(step.id)) return false;
    seen.add(step.id);
    stack.add(step.id);
    for (const id of step.dependencies) {
      const dependency = steps.find((s) => s.id === id);
      if (dependency && visit(dependency, seen, stack)) return true;
    }
    stack.delete(step.id);
    return false;
  };
  return steps.some((step) => visit(step, new Set(), new Set()));
}
