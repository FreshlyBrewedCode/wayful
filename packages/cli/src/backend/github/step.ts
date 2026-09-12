import { WayfulError } from "@domain/errors";
import { formatVersion, identifier, nonEmpty, slots, timestamp } from "@domain/identifier";
import {
  closesStep,
  CURRENT_FORMAT_VERSION,
  type NewStepRecord,
  type StepRecord,
  type StepStatus,
} from "@domain/model";
import { decodeIssueBody, type GithubIssue } from "@backend/github/issue";
import {
  WAYFUL_BLOCKED_LABEL,
  WAYFUL_STEP_LABEL,
  WAYFUL_TYPE_PREFIX,
} from "@backend/github/labels";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

/**
 * The step's native status. Open is pending, or blocked when it carries the
 * `wayful:blocked` label; closed reads its `state_reason` for whether it was
 * completed or cancelled. Nothing about status lives in the body.
 */
function statusFromIssue(issue: GithubIssue): StepStatus {
  if (issue.state === "open")
    return issue.labels.includes(WAYFUL_BLOCKED_LABEL) ? "blocked" : "pending";
  if (issue.state === "closed") {
    if (issue.state_reason === "completed") return "complete";
    if (issue.state_reason === "not_planned") return "cancelled";
    return fail(`step #${issue.number} was closed with an unsupported reason.`);
  }
  return fail(`step #${issue.number} has an unknown state.`);
}

/** The one `wayful:type/<name>` label every step must carry. */
function typeFromLabels(labels: readonly string[], number: number): string {
  const types = labels
    .filter((label) => label.startsWith(WAYFUL_TYPE_PREFIX))
    .map((label) => label.slice(WAYFUL_TYPE_PREFIX.length));
  if (types.length !== 1) fail(`step #${number} must carry exactly one wayful:type/<name> label.`);
  return identifier(types[0], "step type");
}

function arrayField(raw: unknown, label: string): readonly unknown[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`${label} must be an array.`);
  return raw as unknown[];
}

/**
 * The named error the store produces when a dependency is not a `wayful:step`
 * sub-issue of the same map. Issue numbers are repo-global, so nothing
 * structurally prevents a cross-map edge; this is the check that does. The
 * dependent step is named by the `DecodeError` file on a read and by the caller
 * on a write, so only the offending dependency is named here.
 */
export const dependencyOutsideMapError = (dependency: number): WayfulError =>
  new WayfulError({
    message: `#${dependency} is not a wayful:step sub-issue of the same map; a dependency cannot cross maps.`,
  });

/**
 * Decodes one `wayful:step` sub-issue. The title is the step's `description`,
 * the type and status are labels and native state, and `name`, slots,
 * attachments and the reason/summary fields live in the body's `<details>`
 * YAML. `dependencies` are the step's native `blocked_by` edges, passed in
 * because they are not part of the issue object itself. Throws a
 * `WayfulError` on any missing or malformed field so a collection read can
 * collect it as a `DecodeError`.
 */
export function decodeStepIssue(issue: GithubIssue, dependencies: readonly number[]): StepRecord {
  if (!issue.labels.includes(WAYFUL_STEP_LABEL))
    fail(`#${issue.number} is missing the wayful:step label.`);
  const { body, data } = decodeIssueBody(issue.body ?? "");
  formatVersion(data, `step #${issue.number}`, true);
  const name = identifier(data.name, "step name", true);
  const type = typeFromLabels(issue.labels, issue.number);
  const description = nonEmpty(issue.title, "step description");
  const status = statusFromIssue(issue);
  const inputs = arrayField(data.inputs, "step inputs");
  const outputs = arrayField(data.outputs, "step outputs");
  const requiredInputs = slots(data.required_inputs ?? [], "required_inputs");
  const requiredOutputs = slots(data.required_outputs ?? [], "required_outputs");
  if (status === "complete") nonEmpty(data.completion_summary, "completion summary");
  if (status === "cancelled") nonEmpty(data.cancellation_reason, "cancellation reason");
  if (status === "blocked") nonEmpty(data.block_reason, "block reason");
  const closesNow = closesStep(status);
  const closedAt = closesNow
    ? timestamp(issue.closed_at, `step #${issue.number} closed_at`)
    : undefined;
  return {
    format_version: CURRENT_FORMAT_VERSION,
    id: issue.number,
    name,
    type,
    description,
    status,
    dependencies,
    inputs,
    outputs,
    required_inputs: requiredInputs,
    required_outputs: requiredOutputs,
    body,
    completion_summary: data.completion_summary as string | undefined,
    cancellation_reason: data.cancellation_reason as string | undefined,
    block_reason: data.block_reason as string | undefined,
    created_at: timestamp(issue.created_at, `step #${issue.number} created_at`),
    updated_at: timestamp(issue.updated_at, `step #${issue.number} updated_at`),
    closed_at: closedAt,
  };
}

/**
 * The structured residue a step issue's `<details>` block carries. Status, type
 * and dependencies are deliberately absent: they are GitHub-native and
 * authoritative there, and no fact is stored in two places.
 */
export function stepIssueData(step: StepRecord | NewStepRecord): Record<string, unknown> {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: step.name,
    inputs: step.inputs,
    outputs: step.outputs,
    required_inputs: step.required_inputs,
    required_outputs: step.required_outputs,
    ...(step.completion_summary !== undefined
      ? { completion_summary: step.completion_summary }
      : {}),
    ...(step.cancellation_reason !== undefined
      ? { cancellation_reason: step.cancellation_reason }
      : {}),
    ...(step.block_reason !== undefined ? { block_reason: step.block_reason } : {}),
  };
}
