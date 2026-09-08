import type { Slot } from "./identifier";
import type { ArtifactRecord, StepRecord } from "./model";

type Direction = "inputs" | "outputs";

function requiredSlots(step: StepRecord, direction: Direction) {
  return direction === "inputs" ? step.required_inputs : step.required_outputs;
}

/** A single valid attachment, normalized out of a step's raw `inputs`/`outputs`. */
export interface AttachmentView {
  readonly slot: string | undefined;
  readonly artifactName: string;
}

/**
 * Normalizes a step's raw `inputs`/`outputs` into the attachments that decode
 * validly, silently dropping malformed entries — `attachmentErrors` below is
 * what reports those, for `map validate`. Used by `context` step and
 * artifact scope (issue #8) to read attachments without re-deriving their
 * shape, and to build the artifact reverse index.
 */
export function normalizedAttachments(attachments: readonly unknown[]): readonly AttachmentView[] {
  return attachments
    .filter(
      (candidate): candidate is { artifact: string; slot?: unknown } =>
        !!candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        typeof (candidate as any).artifact === "string",
    )
    .map((candidate) => ({
      artifactName: candidate.artifact,
      slot: typeof candidate.slot === "string" ? candidate.slot : undefined,
    }));
}

/** Finds the attachment (if any) filling `slotName` among a step's raw `inputs`/`outputs`. */
function findAttachment(
  attachments: StepRecord["inputs"] | StepRecord["outputs"],
  slotName: string,
): { artifact: string; slot: string } | undefined {
  return attachments.find(
    (candidate): candidate is { artifact: string; slot: string } =>
      !!candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as any).slot === slotName,
  );
}

/** Whether a required slot is filled by an attachment naming an artifact of the matching kind. */
function slotFulfilled(
  slot: Slot,
  attachments: StepRecord["inputs"] | StepRecord["outputs"],
  artifacts: readonly ArtifactRecord[],
): boolean {
  const attachment = findAttachment(attachments, slot.name);
  return (
    attachment !== undefined &&
    artifacts.some(
      (artifact) => artifact.name === attachment.artifact && artifact.kind === slot.kind,
    )
  );
}

/**
 * The required slots in `direction` that are not yet fulfilled by a
 * correctly-kinded attachment — the per-slot detail `attachmentOK` collapses
 * into a single boolean. Used by `context` map scope to explain *which*
 * input a pending-not-actionable step is still missing.
 */
export function unfulfilledSlots(
  step: StepRecord,
  direction: Direction,
  artifacts: readonly ArtifactRecord[],
): Slot[] {
  const attachments = step[direction];
  return requiredSlots(step, direction).filter(
    (slot) => !slotFulfilled(slot, attachments, artifacts),
  );
}

export function attachmentOK(
  step: StepRecord,
  direction: Direction,
  artifacts: readonly ArtifactRecord[],
): boolean {
  const attachments = step[direction];
  return requiredSlots(step, direction).every((slot) =>
    slotFulfilled(slot, attachments, artifacts),
  );
}

export function attachmentErrors(
  step: StepRecord,
  direction: Direction,
  artifacts: readonly ArtifactRecord[],
): string[] {
  const errors: string[] = [];
  const attachments = step[direction];
  const required = requiredSlots(step, direction);
  const slotsSeen = new Set<string>();
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      Array.isArray(attachment) ||
      typeof (attachment as any).artifact !== "string"
    ) {
      errors.push(`step '${step.name}' has an invalid ${direction} attachment.`);
      continue;
    }
    const artifactName = (attachment as any).artifact as string;
    const slotName = (attachment as any).slot;
    const artifact = artifacts.find((a) => a.name === artifactName);
    if (!artifact)
      errors.push(`step '${step.name}' has a missing ${direction} artifact '${artifactName}'.`);
    if (slotName === undefined) continue;
    if (typeof slotName !== "string") {
      errors.push(`step '${step.name}' has an invalid ${direction} slot attachment.`);
      continue;
    }
    const slot = required.find((candidate) => candidate.name === slotName);
    if (!slot) {
      errors.push(`step '${step.name}' has an unknown ${direction} slot '${slotName}'.`);
      continue;
    }
    if (slotsSeen.has(slotName))
      errors.push(`step '${step.name}' fulfills ${direction} slot '${slotName}' more than once.`);
    slotsSeen.add(slotName);
    if (artifact && artifact.kind !== slot.kind)
      errors.push(
        `step '${step.name}' attaches wrong artifact kind to ${direction} slot '${slotName}'.`,
      );
  }
  return errors;
}

export function dependenciesOK(step: StepRecord, steps: readonly StepRecord[]): boolean {
  return step.dependencies.every((id) => steps.find((s) => s.id === id)?.status === "complete");
}

export function nextSteps(
  steps: readonly StepRecord[],
  artifacts: readonly ArtifactRecord[],
): StepRecord[] {
  return steps
    .filter(
      (step) =>
        step.status === "pending" &&
        dependenciesOK(step, steps) &&
        attachmentOK(step, "inputs", artifacts),
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
