import { WayfulError } from "@domain/errors";
import { formatVersion, identifier, nonEmpty, timestamp } from "@domain/identifier";
import { CURRENT_FORMAT_VERSION, type MapMetadata } from "@domain/model";
import { decodeIssueBody, type GithubIssue } from "@backend/github/issue";
import { WAYFUL_MAP_LABEL } from "@backend/github/labels";

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

function decodeAllowedStepTypes(raw: unknown): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) fail("map allowed_step_types must be an array.");
  const seen = new Set<string>();
  return (raw as unknown[]).map((value) => {
    const name = identifier(value, "allowed step type");
    if (seen.has(name)) fail(`map allowed_step_types repeats '${name}'.`);
    seen.add(name);
    return name;
  });
}

/**
 * Decodes one `wayful:map` issue. The title is the map's `start` — the
 * human-readable one-liner — and `name` and the remaining structured fields
 * live in the body's `<details>` YAML; timestamps come from GitHub itself.
 * Throws a `WayfulError` on any missing or malformed field so a collection
 * read can collect it as a `DecodeError`.
 */
export function decodeMapIssue(issue: GithubIssue): MapMetadata {
  if (!issue.labels.includes(WAYFUL_MAP_LABEL))
    fail(`#${issue.number} is missing the wayful:map label.`);
  const { data } = decodeIssueBody(issue.body ?? "");
  formatVersion(data, `map #${issue.number}`, true);
  const name = identifier(data.name, "map name", true);
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    start: nonEmpty(issue.title, "map start"),
    allowed_step_types: decodeAllowedStepTypes(data.allowed_step_types),
    created_at: timestamp(issue.created_at, `map #${issue.number} created_at`),
    updated_at: timestamp(issue.updated_at, `map #${issue.number} updated_at`),
  };
}

/** The structured residue a map issue's `<details>` block carries. */
export function mapIssueData(
  name: string,
  allowedStepTypes?: readonly string[],
): Record<string, unknown> {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    ...(allowedStepTypes !== undefined ? { allowed_step_types: allowedStepTypes } : {}),
  };
}
