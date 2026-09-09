import { Effect, Result } from "effect";

import { WayfulError } from "../../../domain/errors";
import {
  CURRENT_FORMAT_VERSION,
  type CollectionRead,
  type DecodeError,
  type GoalRecord,
  type MapMetadata,
  type StepRecord,
} from "../../../domain/model";

// Effect.gen treats a bare `throw` as a defect, not a typed failure, so
// backend operations that need to short-circuit with a WayfulError must
// `yield* fail(...)` rather than call a throwing helper directly.
export const fail = (message: string) => Effect.fail(new WayfulError({ message }));

export const accessError = () => new WayfulError({ message: "cannot access filesystem." });

/**
 * Runs `decode` for each item in `items`, collecting successes and turning
 * any failure into a `DecodeError` keyed by `fileFor(item)` instead of
 * aborting the whole read. This is the skip-and-collect contract every
 * collection read shares: a broken sibling never hides a healthy one.
 */
export function collect<I, T, E extends { readonly message: string }>(
  items: readonly I[],
  fileFor: (item: I) => string,
  decode: (item: I) => Effect.Effect<T, E>,
): Effect.Effect<CollectionRead<T>, never> {
  return Effect.gen(function* () {
    const records: T[] = [];
    const errors: DecodeError[] = [];
    for (const item of items) {
      const result = yield* Effect.result(decode(item));
      if (Result.isFailure(result))
        errors.push({ file: fileFor(item), message: result.failure.message });
      else records.push(result.success);
    }
    return { records, errors };
  });
}

export function mapMetadataToToml(metadata: MapMetadata): Record<string, unknown> {
  const record: Record<string, unknown> = {
    format_version: metadata.format_version,
    name: metadata.name,
    start: metadata.start,
    step_id_counter: metadata.step_id_counter,
    artifact_id_counter: metadata.artifact_id_counter,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
  };
  if (metadata.allowed_step_types !== undefined)
    record.allowed_step_types = metadata.allowed_step_types;
  return record;
}

export function stepToDocument(step: StepRecord): Record<string, unknown> {
  const document: Record<string, unknown> = {
    format_version: CURRENT_FORMAT_VERSION,
    id: step.id,
    name: step.name,
    type: step.type,
    description: step.description,
    status: step.status,
    dependencies: step.dependencies,
    inputs: step.inputs,
    outputs: step.outputs,
    required_inputs: step.required_inputs,
    required_outputs: step.required_outputs,
    created_at: step.created_at,
    updated_at: step.updated_at,
  };
  if (step.completion_summary !== undefined) document.completion_summary = step.completion_summary;
  if (step.cancellation_reason !== undefined)
    document.cancellation_reason = step.cancellation_reason;
  if (step.block_reason !== undefined) document.block_reason = step.block_reason;
  if (step.closed_at !== undefined) document.closed_at = step.closed_at;
  return document;
}

export function goalToDocument(goal: GoalRecord): Record<string, unknown> {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: goal.name,
    description: goal.description,
    evidence: goal.evidence,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };
}
