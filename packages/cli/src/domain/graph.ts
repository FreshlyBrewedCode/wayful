import type { Slot } from "./identifier";
import type { StepRecord } from "./model";

type Direction = "inputs" | "outputs";

function requiredSlots(step: StepRecord, direction: Direction) {
  return direction === "inputs" ? step.required_inputs : step.required_outputs;
}

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
 * The required slots in `direction` that are not yet fulfilled — the
 * per-slot detail `attachmentOK` collapses into a single boolean. Used by
 * `context` map scope to explain *which* input a pending-not-actionable step
 * is still missing.
 */
export function unfulfilledSlots(step: StepRecord, direction: Direction): Slot[] {
  const attachments = step[direction];
  return requiredSlots(step, direction).filter((slot) => !slotFulfilled(slot, attachments));
}

export function attachmentOK(step: StepRecord, direction: Direction): boolean {
  const attachments = step[direction];
  return requiredSlots(step, direction).every((slot) => slotFulfilled(slot, attachments));
}

export function attachmentErrors(step: StepRecord, direction: Direction): string[] {
  const errors: string[] = [];
  const attachments = step[direction];
  const required = requiredSlots(step, direction);
  const slotsSeen = new Set<string>();
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      errors.push(`step '${step.name}' has an invalid ${direction} attachment.`);
      continue;
    }
    const a = attachment as Record<string, unknown>;
    if (typeof a.ref !== "string") {
      errors.push(`step '${step.name}' has an invalid ${direction} attachment.`);
      continue;
    }
    const hasSlot = typeof a.slot === "string";
    const hasKind = typeof a.kind === "string";
    if (hasSlot === hasKind) {
      errors.push(`step '${step.name}' has an invalid ${direction} attachment.`);
      continue;
    }
    if (!hasSlot) continue; // supplementary: no further checks
    const slotName = a.slot as string;
    const slot = required.find((candidate) => candidate.name === slotName);
    if (!slot) {
      errors.push(`step '${step.name}' has an unknown ${direction} slot '${slotName}'.`);
      continue;
    }
    if (slotsSeen.has(slotName))
      errors.push(`step '${step.name}' fulfills ${direction} slot '${slotName}' more than once.`);
    slotsSeen.add(slotName);
  }
  return errors;
}

export function dependenciesOK(step: StepRecord, steps: readonly StepRecord[]): boolean {
  return step.dependencies.every((id) => steps.find((s) => s.id === id)?.status === "complete");
}

export function nextSteps(steps: readonly StepRecord[]): StepRecord[] {
  return steps
    .filter(
      (step) =>
        step.status === "pending" && dependenciesOK(step, steps) && attachmentOK(step, "inputs"),
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
