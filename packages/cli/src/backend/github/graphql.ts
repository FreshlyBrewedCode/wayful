import { Effect, Redacted } from "effect";
import { HttpClientRequest } from "effect/unstable/http";

import { WayfulError } from "@domain/errors";
import { apiBase, authorized } from "@backend/github/api";
import { GithubHttp, requestFailed } from "@backend/github/http";
import type { GithubIssue } from "@backend/github/issue";
import type { GitRemoteRef } from "@backend/github/remote";

/**
 * One sub-issue of a map: the normalized issue plus its native `blocked_by`
 * dependency numbers. Dependencies are not part of the issue object itself, so
 * the query fetches them alongside.
 */
export interface SnapshotChild {
  readonly issue: GithubIssue;
  readonly dependencies: readonly number[];
}

export interface MapSnapshotRead {
  readonly map: GithubIssue;
  readonly children: readonly SnapshotChild[];
}

// A GraphQL fragment keeps the map and every child selection identical; the
// map adds only `subIssues`, and each child adds only `blockedBy`.
const ISSUE_FIELDS = `
fragment WayfulIssue on Issue {
  number
  databaseId
  title
  body
  state
  stateReason
  labels(first: 100) { nodes { name } }
  createdAt
  updatedAt
  closedAt
}`;

const MAP_SNAPSHOT_QUERY = `
${ISSUE_FIELDS}
query WayfulMapSnapshot($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      ...WayfulIssue
      subIssues(first: 100) {
        nodes {
          ...WayfulIssue
          blockedBy(first: 100) { nodes { number } }
        }
      }
    }
  }
}`;

function isoMillis(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function labelNames(raw: unknown): readonly string[] {
  const nodes = (raw as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => (node as { name?: unknown } | undefined)?.name)
    .filter((name): name is string => typeof name === "string");
}

/**
 * Normalizes one GraphQL issue into the same shape the REST path produces.
 * GraphQL names the fields differently — `databaseId` is the numeric id,
 * `state`/`stateReason` are upper-case enums, and timestamps omit milliseconds
 * — so decode receives one canonical `GithubIssue` regardless of transport.
 * Missing fields are rendered empty rather than guessed, leaving the decoder
 * to reject them with a precise message.
 */
function normalizeIssue(node: unknown): GithubIssue | undefined {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  const record = node as Record<string, unknown>;
  const databaseId = typeof record.databaseId === "number" ? record.databaseId : undefined;
  if (databaseId === undefined) return undefined;
  return {
    id: databaseId,
    number: typeof record.number === "number" ? record.number : 0,
    title: typeof record.title === "string" ? record.title : "",
    body: typeof record.body === "string" ? record.body : null,
    state: typeof record.state === "string" ? record.state.toLowerCase() : "",
    state_reason: typeof record.stateReason === "string" ? record.stateReason.toLowerCase() : null,
    labels: labelNames(record.labels),
    created_at: isoMillis(record.createdAt),
    updated_at: isoMillis(record.updatedAt),
    closed_at:
      record.closedAt === null || record.closedAt === undefined ? null : isoMillis(record.closedAt),
  };
}

function blockedNumbers(node: Record<string, unknown>): readonly number[] {
  const nodes = (node.blockedBy as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((blocking) => (blocking as { number?: unknown } | undefined)?.number)
    .filter((number): number is number => typeof number === "number");
}

function graphqlMessage(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  return errors
    .map((error) => (error as { message?: unknown } | undefined)?.message)
    .filter((message): message is string => typeof message === "string")
    .join("; ");
}

/**
 * Reads a whole map in one GraphQL round trip: the map issue and its step and
 * goal sub-issues, with their labels, native state and `blocked_by`
 * dependencies. Callers decode the normalized issues exactly as they decode
 * the REST reads, so this is a transport change, not a second model.
 */
export function readMapSnapshot(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
): Effect.Effect<MapSnapshotRead, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const http = yield* GithubHttp;
    const base = apiBase(repo.host);
    const request = authorized(HttpClientRequest.post(base.graphql), token).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        query: MAP_SNAPSHOT_QUERY,
        variables: { owner: repo.owner, repo: repo.repo, number },
      }),
    );
    const response = yield* http.execute(request);
    if (response.status < 200 || response.status >= 300)
      return yield* Effect.fail(
        requestFailed(`graphql snapshot failed with status ${response.status}.`),
      );
    const body = (yield* response.json.pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    )) as {
      readonly data?: { readonly repository?: { readonly issue?: unknown } | null } | null;
      readonly errors?: unknown;
    };
    const graphqlError = graphqlMessage(body.errors);
    if (graphqlError) return yield* Effect.fail(requestFailed(graphqlError));
    const raw = body.data?.repository?.issue;
    if (!raw || typeof raw !== "object")
      return yield* Effect.fail(requestFailed(`map #${number} was not found.`));
    const node = raw as Record<string, unknown>;
    const map = normalizeIssue(node);
    if (!map) return yield* Effect.fail(requestFailed(`map #${number} could not be read.`));

    const subIssues = (node.subIssues as { nodes?: unknown } | undefined)?.nodes;
    const children: SnapshotChild[] = [];
    if (Array.isArray(subIssues)) {
      for (const child of subIssues) {
        if (!child || typeof child !== "object") continue;
        const issue = normalizeIssue(child);
        if (!issue) continue;
        children.push({ issue, dependencies: blockedNumbers(child as Record<string, unknown>) });
      }
    }
    return { map, children };
  });
}
