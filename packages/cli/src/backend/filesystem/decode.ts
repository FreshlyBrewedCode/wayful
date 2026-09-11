import { WayfulError } from "../../domain/errors";
import {
  IDENT,
  formatVersion,
  identifier,
  nonEmpty,
  slots,
  timestamp,
} from "../../domain/identifier";
import {
  closesStep,
  CURRENT_FORMAT_VERSION,
  type GoalRecord,
  type MapMetadata,
  type ProjectMetadata,
  type StepRecord,
  type TypeDefinition,
} from "../../domain/model";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

export function decodeProjectMetadata(data: unknown): ProjectMetadata {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("malformed project metadata.");
  const record = data as Record<string, unknown>;
  const allowed = new Set(["format_version", "description", "created_at", "updated_at"]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    typeof record.description !== "string"
  )
    fail("malformed project metadata.");
  formatVersion(record, "project metadata", true);
  const createdAt = timestamp(record.created_at, "project created_at");
  const updatedAt = timestamp(record.updated_at, "project updated_at");
  return {
    format_version: CURRENT_FORMAT_VERSION,
    description: record.description as string,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function decodeMapMetadata(data: unknown, expectedName: string): MapMetadata {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("malformed map metadata.");
  const record = data as Record<string, unknown>;
  const allowed = new Set([
    "format_version",
    "name",
    "start",
    "step_id_counter",
    "allowed_step_types",
    "created_at",
    "updated_at",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) fail("malformed map metadata.");
  formatVersion(record, "map metadata", true);
  if (record.name !== expectedName) fail("malformed map metadata.");
  nonEmpty(record.start, "map start");
  if (!Number.isInteger(record.step_id_counter) || (record.step_id_counter as number) < 1)
    fail("malformed map metadata.");
  let allowedStepTypes: readonly string[] | undefined;
  if (record.allowed_step_types !== undefined) {
    const list = record.allowed_step_types;
    if (
      !Array.isArray(list) ||
      list.some((x) => typeof x !== "string" || !IDENT.test(x)) ||
      new Set(list).size !== list.length
    )
      fail("malformed map metadata.");
    allowedStepTypes = list as string[];
  }
  const createdAt = timestamp(record.created_at, "map created_at");
  const updatedAt = timestamp(record.updated_at, "map updated_at");
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: expectedName,
    start: record.start as string,
    allowed_step_types: allowedStepTypes,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function decodeType(
  fileStem: string,
  data: Record<string, unknown>,
  body: string,
): TypeDefinition {
  formatVersion(data, `type '${fileStem}'`);
  if (data.name !== fileStem) fail(`type filename and name do not match for '${fileStem}'.`);
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: identifier(data.name, "type name"),
    description: nonEmpty(data.description, "type description"),
    required_inputs: slots(data.required_inputs ?? [], "required_inputs"),
    required_outputs: slots(data.required_outputs ?? [], "required_outputs"),
    instructions: body,
  };
}

export function decodeStep(
  filename: string,
  data: Record<string, unknown>,
  body: string,
): StepRecord {
  formatVersion(data, "step");
  if (!Number.isInteger(data.id) || (data.id as number) < 1) fail("invalid step ID.");
  const name = identifier(data.name, "step name", true);
  const type = identifier(data.type, "step type");
  const description = nonEmpty(data.description, "step description");
  if (!["pending", "blocked", "complete", "cancelled"].includes(data.status as string))
    fail("invalid step status.");
  if (
    !Array.isArray(data.dependencies) ||
    (data.dependencies as unknown[]).some((x) => !Number.isInteger(x))
  )
    fail("invalid step dependencies.");
  if (!Array.isArray(data.inputs) || !Array.isArray(data.outputs))
    fail("invalid step attachments.");
  const requiredInputs = slots(data.required_inputs, "required_inputs");
  const requiredOutputs = slots(data.required_outputs, "required_outputs");
  const status = data.status as StepRecord["status"];
  if (status === "complete") nonEmpty(data.completion_summary, "completion summary");
  if (status === "cancelled") nonEmpty(data.cancellation_reason, "cancellation reason");
  if (status === "blocked") nonEmpty(data.block_reason, "block reason");
  if (filename !== `${data.id}-${data.name}.md`)
    fail(`step filename does not match identity (${filename}).`);
  const createdAt = timestamp(data.created_at, "step created_at");
  const updatedAt = timestamp(data.updated_at, "step updated_at");
  const closesNow = closesStep(status);
  const closedAt = closesNow ? timestamp(data.closed_at, "step closed_at") : undefined;
  if (!closesNow && data.closed_at !== undefined) fail("step closed_at must be absent.");
  return {
    format_version: CURRENT_FORMAT_VERSION,
    id: data.id as number,
    name,
    type,
    description,
    status,
    dependencies: data.dependencies as number[],
    inputs: data.inputs as unknown[],
    outputs: data.outputs as unknown[],
    required_inputs: requiredInputs,
    required_outputs: requiredOutputs,
    body,
    completion_summary: data.completion_summary as string | undefined,
    cancellation_reason: data.cancellation_reason as string | undefined,
    block_reason: data.block_reason as string | undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    closed_at: closedAt,
  };
}

export function decodeGoal(
  filename: string,
  data: Record<string, unknown>,
  body: string,
): GoalRecord {
  formatVersion(data, `goal '${filename}'`);
  const name = identifier(data.name, "goal name");
  const description = nonEmpty(data.description, "goal description");
  if (!Array.isArray(data.outputs)) fail(`invalid goal outputs (${filename}).`);
  const requiredOutputs = slots(data.required_outputs, "required_outputs");
  if (filename !== `${name}.md`) fail(`goal filename does not match identity (${filename}).`);
  const createdAt = timestamp(data.created_at, "goal created_at");
  const updatedAt = timestamp(data.updated_at, "goal updated_at");
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    description,
    outputs: data.outputs as unknown[],
    required_outputs: requiredOutputs,
    body,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}
