import { Effect, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { WayfulError } from "../../domain/errors";
import type { GithubIssue } from "./issue";
import type { GitRemoteRef } from "./remote";

export interface ApiBase {
  readonly rest: string;
  readonly graphql: string;
}

/** `github.com` resolves to the public REST/GraphQL hosts; any other host is treated as GitHub Enterprise Server. */
export function apiBase(host: string): ApiBase {
  if (host === "github.com") {
    return { rest: "https://api.github.com", graphql: "https://api.github.com/graphql" };
  }
  return { rest: `https://${host}/api/v3`, graphql: `https://${host}/api/graphql` };
}

function requestFailed(reason: string): WayfulError {
  return new WayfulError({ message: `github api request failed: ${reason}` });
}

function insufficientAccess(repo: GitRemoteRef): WayfulError {
  return new WayfulError({
    message: `github token cannot access ${repo.owner}/${repo.repo}; run 'gh auth login' with repo scope or check the token's permissions.`,
  });
}

function authorized(
  request: HttpClientRequest.HttpClientRequest,
  token: Redacted.Redacted<string>,
) {
  return request.pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.accept("application/vnd.github+json"),
  );
}

/**
 * Confirms `token` can push to `repo`, failing with a `WayfulError` (never
 * including the token) otherwise.
 */
export function verifyAccess(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
): Effect.Effect<void, WayfulError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.get(`${base.rest}/repos/${repo.owner}/${repo.repo}`),
      token,
    );
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    );
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return yield* Effect.fail(insufficientAccess(repo));
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(requestFailed(`unexpected status ${response.status}.`));
    }
    const body = yield* response.json.pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    );
    const permissions = Option.fromNullishOr(
      (body as { permissions?: { push?: boolean } }).permissions,
    );
    const canPush = Option.match(permissions, {
      onNone: () => false,
      onSome: (p) => p.push === true,
    });
    if (!canPush) return yield* Effect.fail(insufficientAccess(repo));
  });
}

export interface Label {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

/** Creates `label` on `repo`, treating an "already exists" 422 as success. */
export function ensureLabel(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  label: Label,
): Effect.Effect<void, WayfulError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(`${base.rest}/repos/${repo.owner}/${repo.repo}/labels`),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe(label));
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    );
    if (response.status === 201 || response.status === 422) return;
    return yield* Effect.fail(
      requestFailed(`could not create label "${label.name}" (status ${response.status}).`),
    );
  });
}

/** Creates every label in `labels`, in order. */
export function ensureLabels(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  labels: ReadonlyArray<Label>,
): Effect.Effect<void, WayfulError, HttpClient.HttpClient> {
  return Effect.forEach(labels, (label) => ensureLabel(repo, token, label), { discard: true });
}

/**
 * Normalizes one REST issue. Returns `undefined` for pull requests, which the
 * issues endpoint returns interleaved but which are never wayful records.
 * Missing or wrongly-typed fields are left for `decodeMapIssue` to reject with
 * a precise message, rather than guessed at here.
 */
function normalizeIssue(raw: unknown): GithubIssue | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.pull_request !== undefined) return undefined;
  const labels = Array.isArray(record.labels)
    ? record.labels
        .map((label) =>
          label && typeof label === "object" ? (label as { name?: unknown }).name : label,
        )
        .filter((name): name is string => typeof name === "string")
    : [];
  return {
    number: record.number as number,
    title: typeof record.title === "string" ? record.title : "",
    body: typeof record.body === "string" ? record.body : null,
    state: typeof record.state === "string" ? record.state : "",
    labels,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

function nextLink(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match && match[2] === "next") return match[1];
  }
  return undefined;
}

export interface ListIssuesOptions {
  readonly labels?: readonly string[];
  readonly state?: "open" | "closed" | "all";
}

/**
 * Every open issue matching `labels`, newest page first, following `Link`
 * pagination. Never the Search API: search is eventually consistent, so a
 * freshly created map would be intermittently invisible.
 */
export function listIssues(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  options: ListIssuesOptions = {},
): Effect.Effect<readonly GithubIssue[], WayfulError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const url = new URL(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("state", options.state ?? "open");
    if (options.labels?.length) url.searchParams.set("labels", options.labels.join(","));

    const issues: GithubIssue[] = [];
    let next: string | undefined = url.toString();
    while (next !== undefined) {
      const request = authorized(HttpClientRequest.get(next), token);
      const response = yield* HttpClient.execute(request).pipe(
        Effect.mapError((error) => requestFailed(error.message)),
      );
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(requestFailed(`unexpected status ${response.status}.`));
      const page = yield* response.json.pipe(
        Effect.mapError((error) => requestFailed(error.message)),
      );
      if (!Array.isArray(page))
        return yield* Effect.fail(requestFailed("expected a JSON array of issues."));
      for (const raw of page) {
        const issue = normalizeIssue(raw);
        if (issue) issues.push(issue);
      }
      next = nextLink(response.headers["link"]);
    }
    return issues;
  });
}

export interface NewIssue {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/** Creates an issue and returns GitHub's canonical view of it. */
export function createIssue(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  issue: NewIssue,
): Effect.Effect<GithubIssue, WayfulError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues`),
      token,
    ).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
    );
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    );
    if (response.status !== 201)
      return yield* Effect.fail(
        requestFailed(`could not create issue (status ${response.status}).`),
      );
    const body = yield* response.json.pipe(
      Effect.mapError((error) => requestFailed(error.message)),
    );
    const created = normalizeIssue(body);
    if (!created) return yield* Effect.fail(requestFailed("the created issue could not be read."));
    return created;
  });
}
