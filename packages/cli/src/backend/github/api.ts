import { DateTime, Effect, Option, Redacted } from "effect";
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";

import { oneLine, WayfulError } from "@domain/errors";
import {
  GithubHttp,
  GithubRequestError,
  githubMessage,
  githubRequestError,
  unreadableResponse,
  type GithubFailure,
} from "@backend/github/http";
import type { GithubIssue } from "@backend/github/issue";
import type { GitRemoteRef } from "@backend/github/remote";
import { subIssueCapError } from "@backend/github/subIssues";

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

export function repoLabel(repo: GitRemoteRef): string {
  return `${repo.owner}/${repo.repo}`;
}

/**
 * Phrases a classified transport failure in the caller's terms. The transport
 * reports *what kind* of failure it was; only the caller knows whether the
 * repository itself or a named resource within it was being addressed, and
 * each of the four kinds has a different remedy.
 */
export function githubFailure(
  repo: GitRemoteRef,
  failure: GithubFailure,
  resource?: string,
): WayfulError {
  const where = resource === undefined ? repoLabel(repo) : `${resource} in ${repoLabel(repo)}`;
  switch (failure.kind) {
    case "unauthenticated":
      return new WayfulError({
        message: `the github credential for ${where} is invalid or expired (status ${failure.status}); run 'gh auth login' or set GH_TOKEN to supply a working token.`,
      });
    case "forbidden":
      return new WayfulError({
        message: `the github credential is valid but cannot access ${where} (status ${failure.status}); check the token's repository access and scope.`,
      });
    case "not-found":
      return new WayfulError({
        message:
          resource === undefined
            ? `github cannot find ${where} (status ${failure.status}); it may not exist or may not be visible to the current credential.`
            : `github cannot find ${where} (status ${failure.status}); it may have been deleted, renamed, or not be visible to the current credential.`,
      });
    case "unexpected":
      return new WayfulError({
        message: `github could not complete the request for ${where} (status ${failure.status})${failure.message ? `: ${oneLine(failure.message)}` : "."}`,
      });
  }
}

/** Fails with the caller-terms message for a non-2xx response. */
export function responseFailure(
  repo: GitRemoteRef,
  response: HttpClientResponse.HttpClientResponse,
  resource?: string,
): Effect.Effect<never, WayfulError> {
  return Effect.gen(function* () {
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
    return yield* githubFailure(
      repo,
      githubRequestError(response.status, githubMessage(text)),
      resource,
    );
  });
}

/** Adds the bearer token and the JSON media type every GitHub request needs. */
export function authorized(
  request: HttpClientRequest.HttpClientRequest,
  token: Redacted.Redacted<string>,
) {
  return request.pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.accept("application/vnd.github+json"),
  );
}

/** Executes one request through the shared budgeted transport. */
function execute(request: HttpClientRequest.HttpClientRequest) {
  return Effect.flatMap(GithubHttp, (http) => http.execute(request));
}

/**
 * A conditional `GET` through the shared transport, cached and revalidated with
 * ETags. The transport's classified failure is rewritten with the repository
 * the request addressed, so the message names what was being read.
 */
function fetchJson(
  repo: GitRemoteRef,
  request: HttpClientRequest.HttpClientRequest,
  resource?: string,
) {
  return Effect.flatMap(GithubHttp, (http) => http.getJson(request)).pipe(
    Effect.mapError((error) =>
      error instanceof GithubRequestError ? githubFailure(repo, error, resource) : error,
    ),
  );
}

/**
 * Confirms `token` can push to `repo`, failing with a `WayfulError` (never
 * including the token) otherwise.
 */
export function verifyAccess(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.get(`${base.rest}/repos/${repo.owner}/${repo.repo}`),
      token,
    );
    const response = yield* execute(request);
    if (response.status < 200 || response.status >= 300)
      return yield* responseFailure(repo, response);
    const body = yield* response.json.pipe(
      Effect.mapError((error) => unreadableResponse(error.message)),
    );
    const permissions = Option.fromNullishOr(
      (body as { permissions?: { push?: boolean } }).permissions,
    );
    const canPush = Option.match(permissions, {
      onNone: () => false,
      onSome: (p) => p.push === true,
    });
    if (!canPush)
      return yield* new WayfulError({
        message: `the github credential is valid but cannot push to ${repoLabel(repo)}; check the token's repository access and scope.`,
      });
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
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(`${base.rest}/repos/${repo.owner}/${repo.repo}/labels`),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe(label));
    const response = yield* execute(request);
    if (response.status === 201 || response.status === 422) return;
    return yield* responseFailure(repo, response, `label "${label.name}"`);
  });
}

/** Creates every label in `labels`, in order. */
export function ensureLabels(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  labels: ReadonlyArray<Label>,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.forEach(labels, (label) => ensureLabel(repo, token, label), { discard: true });
}

/**
 * GitHub's REST timestamps are second-precision (`2026-01-01T00:00:00Z`)
 * while the domain's canonical shape — and the GraphQL path, via
 * `isoMillis` — is millisecond-precision. Normalizing here keeps one
 * timestamp shape regardless of transport, so a REST-read record decodes the
 * same way a GraphQL-read one does.
 */
function isoMillis(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = DateTime.make(value);
  return Option.isNone(date) ? "" : DateTime.formatIso(date.value);
}

/**
 * Normalizes one REST issue. Returns `undefined` for pull requests, which the
 * issues endpoint returns interleaved but which are never wayful records, and
 * for a record without an issue number, which cannot be addressed. Every other
 * field is rendered or left empty for `decodeMapIssue` to reject with a
 * precise message, rather than guessed at here.
 */
function normalizeIssue(raw: unknown): GithubIssue | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.pull_request !== undefined || typeof record.number !== "number") return undefined;
  const labels = Array.isArray(record.labels)
    ? record.labels
        .map((label) =>
          label && typeof label === "object" ? (label as { name?: unknown }).name : label,
        )
        .filter((name): name is string => typeof name === "string")
    : [];
  return {
    id: typeof record.id === "number" ? record.id : record.number,
    number: record.number,
    title: typeof record.title === "string" ? record.title : "",
    body: typeof record.body === "string" ? record.body : null,
    state: typeof record.state === "string" ? record.state : "",
    state_reason: typeof record.state_reason === "string" ? record.state_reason : null,
    labels,
    created_at: isoMillis(record.created_at),
    updated_at: isoMillis(record.updated_at),
    closed_at:
      record.closed_at === null || record.closed_at === undefined
        ? null
        : isoMillis(record.closed_at),
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
 * Every issue reachable from `initialUrl` through `Link` pagination, newest
 * page first. Shared by the label-filtered issue listing and the sub-issue
 * listing so both follow pagination identically.
 */
function listPaginated(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  initialUrl: string,
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const issues: GithubIssue[] = [];
    let next: string | undefined = initialUrl;
    while (next !== undefined) {
      const { value, headers } = yield* fetchJson(
        repo,
        authorized(HttpClientRequest.get(next), token),
      );
      if (!Array.isArray(value))
        return yield* new WayfulError({
          message: `github returned an unexpected response for ${repoLabel(repo)}; expected a JSON array of issues.`,
        });
      for (const raw of value) {
        const issue = normalizeIssue(raw);
        if (issue) issues.push(issue);
      }
      next = nextLink(headers["link"]);
    }
    return issues;
  });
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
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  const base = apiBase(repo.host);
  const url = new URL(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("state", options.state ?? "open");
  if (options.labels?.length) url.searchParams.set("labels", options.labels.join(","));
  return listPaginated(repo, token, url.toString());
}

/** Every sub-issue of `parent`, which is how a map's steps and goals are listed. */
export function listSubIssues(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  parent: number,
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  const base = apiBase(repo.host);
  const url = `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${parent}/sub_issues?per_page=100`;
  return listPaginated(repo, token, url);
}

/**
 * Every issue `number` is blocked by, read from GitHub's native dependency
 * edges — the canonical, UI-visible representation. Paginated like every other
 * list.
 */
export function listBlockedBy(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  const base = apiBase(repo.host);
  const url = `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}/dependencies/blocked_by?per_page=100`;
  return listPaginated(repo, token, url);
}

/** One issue by number, or a `WayfulError` when it cannot be read. */
export function getIssue(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
): Effect.Effect<GithubIssue, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const { value } = yield* fetchJson(
      repo,
      authorized(
        HttpClientRequest.get(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}`),
        token,
      ),
      `issue #${number}`,
    );
    const issue = normalizeIssue(value);
    if (!issue)
      return yield* new WayfulError({
        message: `github returned an unexpected representation of issue #${number} in ${repoLabel(repo)}.`,
      });
    return issue;
  });
}

/** The mutable issue fields, each scoped to the field it names. */
export interface IssuePatch {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned";
}

/** Patches only the fields present in `patch`, never the others. */
export function updateIssue(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
  patch: IssuePatch,
): Effect.Effect<void, WayfulError, GithubHttp> {
  if (Object.keys(patch).length === 0) return Effect.void;
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.patch(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}`),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe(patch));
    const response = yield* execute(request);
    if (response.status < 200 || response.status >= 300)
      return yield* responseFailure(repo, response, `issue #${number}`);
  });
}

/** Adds `labels` to an issue; already-present labels are not reported as errors. */
export function addLabels(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
  labels: readonly string[],
): Effect.Effect<void, WayfulError, GithubHttp> {
  if (labels.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(
        `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}/labels`,
      ),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe({ labels }));
    const response = yield* execute(request);
    if (response.status < 200 || response.status >= 300)
      return yield* responseFailure(repo, response, `issue #${number}`);
  });
}

/** Removes one label from an issue; an absent label (404) is success. */
export function removeLabel(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
  label: string,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.delete(
        `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
      ),
      token,
    );
    const response = yield* execute(request);
    if (response.status === 200 || response.status === 404) return;
    return yield* responseFailure(repo, response, `issue #${number}`);
  });
}

/** Links an existing issue as a sub-issue of `parent` by its database id. */
export function addSubIssue(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  parent: number,
  subIssueId: number,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(
        `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${parent}/sub_issues`,
      ),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe({ sub_issue_id: subIssueId }));
    const response = yield* execute(request);
    if (response.status === 201) return;
    // GitHub rejects the 101st sub-issue with 422; that is a cap, not a raw failure.
    if (response.status === 422) return yield* subIssueCapError();
    return yield* responseFailure(repo, response, `issue #${parent}`);
  });
}

/**
 * Adds a native `blocked_by` edge: `number` is blocked by the issue with the
 * given GitHub database id. The REST API addresses the blocking issue by its
 * database id, not its number.
 */
export function addBlockedBy(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
  blockingIssueId: number,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(
        `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}/dependencies/blocked_by`,
      ),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe({ issue_id: blockingIssueId }));
    const response = yield* execute(request);
    if (response.status === 201) return;
    return yield* responseFailure(repo, response, `issue #${number}`);
  });
}

/** Removes a native `blocked_by` edge, addressed by the blocking issue's database id. */
export function removeBlockedBy(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  number: number,
  blockingIssueId: number,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.delete(
        `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}/dependencies/blocked_by/${blockingIssueId}`,
      ),
      token,
    );
    const response = yield* execute(request);
    if (response.status === 200) return;
    return yield* responseFailure(repo, response, `issue #${number}`);
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
): Effect.Effect<GithubIssue, WayfulError, GithubHttp> {
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
    const response = yield* execute(request);
    if (response.status !== 201) return yield* responseFailure(repo, response, "a new issue");
    const body = yield* response.json.pipe(
      Effect.mapError((error) => unreadableResponse(error.message)),
    );
    const created = normalizeIssue(body);
    if (!created)
      return yield* new WayfulError({
        message: `github returned an unexpected representation of the created issue in ${repoLabel(repo)}.`,
      });
    return created;
  });
}
