import { WayfulError } from "../../domain/errors";
import { formatVersion, identifier, nonEmpty, slots, timestamp } from "../../domain/identifier";
import type { Slot } from "../../domain/identifier";
import { CURRENT_FORMAT_VERSION, type GoalRecord } from "../../domain/model";
import { decodeIssueBody, encodeIssueBody, type GithubIssue } from "./issue";
import { WAYFUL_GOAL_LABEL } from "./labels";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

function arrayField(raw: unknown, label: string): readonly unknown[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`${label} must be an array.`);
  return raw as unknown[];
}

/**
 * The name and default required output slot of the goal `map create` plants.
 * Every map starts with one goal so a freshly created map is immediately
 * workable; the filesystem backend writes the same shape.
 */
export const INITIAL_GOAL_NAME = "initial-goal";
export const INITIAL_GOAL_REQUIRED_OUTPUTS: readonly Slot[] = [
  { name: "evidence", kind: "artifact" },
];

/**
 * Decodes one `wayful:goal` sub-issue. The title is the goal's `description` —
 * the human-readable one-liner — and `name`, `outputs` and `required_outputs`
 * live in the body's `<details>` YAML; timestamps come from GitHub itself.
 *
 * Satisfaction is read from `outputs`/`required_outputs`, never from the
 * issue's state or a label: the caller derives it with `attachmentOK`. Throws a
 * `WayfulError` on any missing or malformed field so a collection read can
 * collect it as a `DecodeError`.
 */
export function decodeGoalIssue(issue: GithubIssue): GoalRecord {
  if (!issue.labels.includes(WAYFUL_GOAL_LABEL))
    fail(`#${issue.number} is missing the wayful:goal label.`);
  const { body, data } = decodeIssueBody(issue.body ?? "");
  formatVersion(data, `goal #${issue.number}`, true);
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: identifier(data.name, "goal name"),
    description: nonEmpty(issue.title, "goal description"),
    outputs: arrayField(data.outputs, "goal outputs"),
    required_outputs: slots(data.required_outputs ?? [], "required_outputs"),
    body,
    created_at: timestamp(issue.created_at, `goal #${issue.number} created_at`),
    updated_at: timestamp(issue.updated_at, `goal #${issue.number} updated_at`),
  };
}

/**
 * The structured residue a goal issue's `<details>` block carries. The
 * description is deliberately absent: it is the issue title, and no fact is
 * stored in two places.
 */
function goalIssueData(
  name: string,
  outputs: readonly unknown[],
  requiredOutputs: readonly Slot[],
): Record<string, unknown> {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    outputs,
    required_outputs: requiredOutputs,
  };
}

/** The full issue body for a goal: its prose, then the structured residue. */
export function encodeGoalBody(goal: {
  readonly name: string;
  readonly outputs: readonly unknown[];
  readonly required_outputs: readonly Slot[];
  readonly body: string;
}): string {
  return encodeIssueBody(goal.body, goalIssueData(goal.name, goal.outputs, goal.required_outputs));
}
