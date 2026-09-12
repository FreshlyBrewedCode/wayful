import { WayfulError } from "@domain/errors";

/**
 * The subset of a GitHub issue this backend reads. Every field is either
 * GitHub-native and authoritative there (state, timestamps) or part of the
 * issue's own presentation (title, body, labels); nothing here mirrors a fact
 * stored anywhere else.
 */
export interface GithubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly state_reason: string | null;
  readonly labels: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
}

const DETAILS_OPEN = "<details>";
const DETAILS_CLOSE = "</details>";
const YAML_FENCE = /```ya?ml[ \t]*\r?\n([\s\S]*?)```/;

const fail = (message: string): never => {
  throw new WayfulError({ message });
};

/**
 * Every wayful record's issue body: the human prose, then a collapsed
 * `<details>` block wrapping fenced YAML with the structured residue GitHub
 * has no native field for. Collapsed by default so it does not dominate the
 * issue, but plain Markdown a human can edit by hand — which is why it is a
 * `<details>` block and not an HTML comment.
 *
 * Deliberately generic: maps, steps and goals all share this anatomy, and a
 * later primitive reuses it rather than inventing a second body format.
 */
export function encodeIssueBody(prose: string, data: Record<string, unknown>): string {
  const yaml = Bun.YAML.stringify(data, null, 2).trimEnd();
  const prefix = prose.trim() ? `${prose.trimEnd()}\n\n` : "";
  return `${prefix}${DETAILS_OPEN}\n<summary>Wayful data</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n${DETAILS_CLOSE}\n`;
}

/**
 * Splits an issue body back into its human prose and decoded YAML residue,
 * failing with a `WayfulError` (never a raw parse error) when the block is
 * absent or malformed — the caller folds that into a `DecodeError`.
 */
export function decodeIssueBody(body: string): {
  readonly body: string;
  readonly data: Record<string, unknown>;
} {
  const open = body.indexOf(DETAILS_OPEN);
  if (open < 0) fail("issue body has no wayful details block.");
  const close = body.indexOf(DETAILS_CLOSE, open);
  if (close < 0) fail("issue body has no wayful details block.");
  const block = body.slice(open + DETAILS_OPEN.length, close);
  const fence = YAML_FENCE.exec(block);
  if (!fence) fail("issue body has no YAML block.");
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(fence![1]!);
  } catch {
    fail("issue body has malformed YAML.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail("issue body has malformed YAML.");
  return { body: body.slice(0, open).trim(), data: parsed as Record<string, unknown> };
}
