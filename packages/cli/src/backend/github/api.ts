import { Effect, Option, Redacted } from "effect";
import { HttpClientRequest } from "effect/unstable/http";

import { WayfulError } from "../../domain/errors";
import { GithubHttp, requestFailed } from "./http";
import type { GithubIssue } from "./issue";
import type { GitRemoteRef } from "./remote";
import { subIssueCapError } from "./subIssues";

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

function insufficientAccess(repo: GitRemoteRef): WayfulError {
  return new WayfulError({
    message: `github token cannot access ${repo.owner}/${repo.repo}; run 'gh auth login' with repo scope or check the token's permissions.`,
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

/** A conditional `GET` through the shared transport, cached and revalidated with ETags. */
function fetchJson(request: HttpClientRequest.HttpClientRequest) {
  return Effect.flatMap(GithubHttp, (http) => http.getJson(request));
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
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const base = apiBase(repo.host);
    const request = authorized(
      HttpClientRequest.post(`${base.rest}/repos/${repo.owner}/${repo.repo}/labels`),
      token,
    ).pipe(HttpClientRequest.bodyJsonUnsafe(label));
    const response = yield* execute(request);
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
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
  token: Redacted.Redacted<string>,
  initialUrl: string,
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const issues: GithubIssue[] = [];
    let next: string | undefined = initialUrl;
    while (next !== undefined) {
      const { value, headers } = yield* fetchJson(authorized(HttpClientRequest.get(next), token));
      if (!Array.isArray(value))
        return yield* Effect.fail(requestFailed("expected a JSON array of issues."));
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
  return listPaginated(token, url.toString());
}

/** Every sub-issue of `parent`, which is how a map's steps and goals are listed. */
export function listSubIssues(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
  parent: number,
): Effect.Effect<readonly GithubIssue[], WayfulError, GithubHttp> {
  const base = apiBase(repo.host);
  const url = `${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${parent}/sub_issues?per_page=100`;
  return listPaginated(token, url);
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
  return listPaginated(token, url);
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
      authorized(
        HttpClientRequest.get(`${base.rest}/repos/${repo.owner}/${repo.repo}/issues/${number}`),
        token,
      ),
    );
    const issue = normalizeIssue(value);
    if (!issue) return yield* Effect.fail(requestFailed(`could not read issue #${number}.`));
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
      return yield* Effect.fail(requestFailed(`could not update issue #${number}.`));
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
      return yield* Effect.fail(requestFailed(`could not label issue #${number}.`));
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
    return yield* Effect.fail(requestFailed(`could not remove label from issue #${number}.`));
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
    if (response.status === 422) return yield* Effect.fail(subIssueCapError());
    return yield* Effect.fail(
      requestFailed(`could not add sub-issue to #${parent} (status ${response.status}).`),
    );
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
    return yield* Effect.fail(
      requestFailed(`could not add a dependency to issue #${number} (status ${response.status}).`),
    );
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
    return yield* Effect.fail(
      requestFailed(
        `could not remove a dependency from issue #${number} (status ${response.status}).`,
      ),
    );
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
