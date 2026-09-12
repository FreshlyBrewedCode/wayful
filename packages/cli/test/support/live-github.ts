import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, type Redacted, Result } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { FetchHttpClient, HttpClientRequest } from "effect/unstable/http";

import { FileSystemProjectStore } from "@backend/filesystem/layer";
import { apiBase, authorized, ensureLabels, verifyAccess } from "@backend/github/api";
import { GithubCredentials, GithubCredentialsLayer } from "@backend/github/credentials";
import { GithubHttp, GithubHttpLayer } from "@backend/github/http";
import { WAYFUL_LABELS } from "@backend/github/labels";
import { GithubMapStore } from "@backend/github/mapStore";
import type { GitRemoteRef } from "@backend/github/remote";
import { resolveRepo } from "@backend/github/repo";
import { MapStore } from "@backend/MapStore";
import { ProjectStore, type ProjectHandle } from "@backend/ProjectStore";
import { WayfulError } from "@domain/errors";

/**
 * The scratch repository the live suite writes against, as `owner/name`. The
 * suite is entirely absent unless this is set: `bun check` never discovers the
 * `.live.ts` file, and even an explicit `bun test:live` skips with a clear
 * reason when the variable or usable credentials are missing.
 */
export const LIVE_REPO_ENV = "WAYFUL_LIVE_GITHUB_REPO";

/** Services a live effect may reach for once `liveLayer()` is provided. */
export type LiveRequirements =
  | MapStore
  | GithubHttp
  | GithubCredentials
  | ProjectStore
  | ChildProcessSpawner.ChildProcessSpawner;

export interface LiveTarget {
  readonly project: ProjectHandle;
  readonly ref: GitRemoteRef;
  readonly token: Redacted.Redacted<string>;
}

export interface LiveDiscovery {
  readonly target?: LiveTarget;
  readonly reason?: string;
}

/**
 * The real infrastructure, wired the way `main.ts` wires the CLI: the
 * production `HttpClient` (fetch), the budgeted `GithubHttp`, the credential
 * chain (`WAYFUL_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`/`gh auth token`), and
 * the real filesystem `ProjectStore`. `GithubMapStore` layered over all of it
 * is the exact object the other GitHub tests stub, so a stub that disagrees
 * with GitHub makes this suite fail.
 */
export function liveLayer(): Layer.Layer<LiveRequirements> {
  const runtime = Layer.mergeAll(
    BunServices.layer,
    FetchHttpClient.layer,
    GithubHttpLayer.pipe(Layer.provide(FetchHttpClient.layer)),
    GithubCredentialsLayer.pipe(Layer.provide(BunServices.layer)),
  );
  const projectStore = FileSystemProjectStore.pipe(Layer.provide(BunServices.layer));
  const mapStore = GithubMapStore.pipe(Layer.provide(Layer.mergeAll(runtime, projectStore)));
  return Layer.mergeAll(runtime, projectStore, mapStore) as Layer.Layer<LiveRequirements>;
}

export function runLive<A, E, R extends LiveRequirements>(
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  return Effect.runPromise(
    (effect as Effect.Effect<A, E, LiveRequirements>).pipe(
      Effect.provide(liveLayer()),
    ) as Effect.Effect<A, E, never>,
  );
}

/**
 * Resolves the scratch repo and a token that can push to it. Returns a reason
 * instead of throwing when the env var is unset, is malformed, has no usable
 * credentials, or the token cannot access the repo — the suite then skips with
 * that reason rather than failing the run.
 */
export async function discoverLive(): Promise<LiveDiscovery> {
  const raw = process.env[LIVE_REPO_ENV]?.trim();
  if (!raw) return { reason: `${LIVE_REPO_ENV} is not set` };
  const parts = raw.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { reason: `${LIVE_REPO_ENV} must be "owner/name" (got '${raw}')` };

  // The root is only read for on-disk types and file: refs, neither of which
  // this resolution touches; the real temp root is supplied by the suite's
  // `beforeAll` once it knows it is actually running.
  const project: ProjectHandle = {
    root: process.cwd(),
    description: "live GitHub backend suite",
    backend: "github",
    repo: raw,
  };
  const resolution = await Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        const resolved = yield* resolveRepo(project, credentials);
        yield* verifyAccess(resolved.ref, resolved.token);
        return resolved;
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          BunServices.layer,
          FetchHttpClient.layer,
          GithubHttpLayer.pipe(Layer.provide(FetchHttpClient.layer)),
          GithubCredentialsLayer.pipe(Layer.provide(BunServices.layer)),
        ),
      ),
    ),
  );
  if (Result.isFailure(resolution))
    return { reason: `cannot use ${raw}: ${resolution.failure.message}` };
  return { target: { project, ref: resolution.success.ref, token: resolution.success.token } };
}

/** Creates the `wayful:*` labels the suite's records need; idempotent. */
export function ensureLiveLabels(target: LiveTarget): Effect.Effect<void, WayfulError, GithubHttp> {
  return ensureLabels(target.ref, target.token, WAYFUL_LABELS);
}

const issueUrl = (target: LiveTarget, suffix: string) =>
  `${apiBase(target.ref.host).rest}/repos/${target.ref.owner}/${target.ref.repo}${suffix}`;

function accepted(status: number, ...expected: readonly number[]): boolean {
  return expected.includes(status);
}

const ISSUE_NODES_QUERY = `
query LiveIssues($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 100, after: $after, states: [OPEN, CLOSED]) {
      pageInfo { hasNextPage endCursor }
      nodes { id number }
    }
  }
}`;

const DELETE_ISSUE_MUTATION = `
mutation LiveDeleteIssue($id: ID!) {
  deleteIssue(input: { issueId: $id }) { clientMutationId }
}`;

interface IssueNode {
  readonly id: string;
  readonly number: number;
}

function graphQlRequest(target: LiveTarget, query: string, variables: Record<string, unknown>) {
  return authorized(HttpClientRequest.post(apiBase(target.ref.host).graphql), target.token).pipe(
    HttpClientRequest.bodyJsonUnsafe({ query, variables }),
  );
}

/**
 * Every issue (open or closed) with the global node id needed to delete it.
 * GraphQL, not REST, because issues cannot be deleted over REST at all —
 * `deleteIssue` is a GraphQL-only mutation.
 */
function listIssueNodes(
  target: LiveTarget,
): Effect.Effect<readonly IssueNode[], WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const http = yield* GithubHttp;
    const nodes: IssueNode[] = [];
    let after: string | undefined;
    while (true) {
      const response = yield* http.execute(
        graphQlRequest(target, ISSUE_NODES_QUERY, {
          owner: target.ref.owner,
          repo: target.ref.repo,
          after,
        }),
      );
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(
          new WayfulError({ message: `could not list issues (status ${response.status}).` }),
        );
      const body = (yield* response.json.pipe(
        Effect.mapError((error) => new WayfulError({ message: error.message })),
      )) as {
        data?: {
          repository?: {
            issues?: {
              pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
              nodes?: readonly { id?: unknown; number?: unknown }[];
            };
          };
        };
      };
      const connection = body.data?.repository?.issues;
      if (connection === undefined)
        return yield* Effect.fail(
          new WayfulError({ message: "could not list issues: unexpected GraphQL response." }),
        );
      for (const node of connection.nodes ?? [])
        if (typeof node.id === "string" && typeof node.number === "number")
          nodes.push({ id: node.id, number: node.number });
      const pageInfo = connection.pageInfo;
      if (pageInfo?.hasNextPage === true && typeof pageInfo.endCursor === "string")
        after = pageInfo.endCursor;
      else break;
    }
    return nodes;
  });
}

/**
 * Permanently deletes an issue by its global id. An already-gone issue — a
 * repeated teardown, or one removed out of band — resolves as success.
 */
function deleteIssueNode(
  target: LiveTarget,
  id: string,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const http = yield* GithubHttp;
    const response = yield* http.execute(graphQlRequest(target, DELETE_ISSUE_MUTATION, { id }));
    if (response.status < 200 || response.status >= 300)
      return yield* Effect.fail(
        new WayfulError({ message: `could not delete issue (status ${response.status}).` }),
      );
    const body = (yield* response.json.pipe(
      Effect.mapError((error) => new WayfulError({ message: error.message })),
    )) as { errors?: readonly { message?: unknown }[] };
    const message = (body.errors ?? [])
      .map((error) => (typeof error.message === "string" ? error.message : ""))
      .join("; ");
    if (message && !/could not resolve to an issue/i.test(message))
      return yield* Effect.fail(new WayfulError({ message: `could not delete issue: ${message}` }));
  });
}

function deleteLabel(
  target: LiveTarget,
  name: string,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const http = yield* GithubHttp;
    const response = yield* http.execute(
      authorized(
        HttpClientRequest.delete(issueUrl(target, `/labels/${encodeURIComponent(name)}`)),
        target.token,
      ),
    );
    if (accepted(response.status, 204, 404)) return;
    return yield* Effect.fail(
      new WayfulError({
        message: `could not delete label "${name}" (status ${response.status}).`,
      }),
    );
  });
}

function nextLink(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match && match[2] === "next") return match[1];
  }
  return undefined;
}

/** Every label name on the repo, following `Link` pagination. */
function listLabelNames(
  target: LiveTarget,
): Effect.Effect<readonly string[], WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const http = yield* GithubHttp;
    const names: string[] = [];
    let next: string | undefined = `${issueUrl(target, "/labels")}?per_page=100`;
    while (next !== undefined) {
      const response = yield* http.execute(authorized(HttpClientRequest.get(next), target.token));
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(
          new WayfulError({
            message: `could not list labels (status ${response.status}).`,
          }),
        );
      const body = (yield* response.json.pipe(
        Effect.mapError((error) => new WayfulError({ message: error.message })),
      )) as readonly { readonly name?: unknown }[];
      for (const label of body) if (typeof label.name === "string") names.push(label.name);
      next = nextLink(response.headers["link"]);
    }
    return names;
  });
}

/**
 * The repo's own records at the start of a run: every issue number and label
 * name. Teardown diffs against it, so the suite leaves the scratch repo exactly
 * as it found it — on pass and on failure — without tracking what it created.
 */
export interface RepoSnapshot {
  readonly issues: ReadonlySet<number>;
  readonly labels: ReadonlySet<string>;
}

export function snapshotRepo(
  target: LiveTarget,
): Effect.Effect<RepoSnapshot, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const issues = yield* listIssueNodes(target);
    const labels = yield* listLabelNames(target);
    return { issues: new Set(issues.map((issue) => issue.number)), labels: new Set(labels) };
  });
}

/**
 * Deletes everything created since `snapshot` — every issue and label that was
 * not there before. Deletion is best-effort but not silently skipped: an issue
 * that cannot be removed fails the teardown, so a leak is visible rather than
 * reported as clean.
 *
 * GitHub's own issue listing is eventually consistent (a just-created issue can
 * take seconds to appear), so teardown makes several passes: delete every extra
 * it can see, pause for the listing to catch up, and repeat until a pass finds
 * nothing left. A delete of an already-deleted issue is a no-op.
 */
export function restoreRepo(
  target: LiveTarget,
  snapshot: RepoSnapshot,
): Effect.Effect<void, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    for (let pass = 0; pass < 12; pass++) {
      const issues = yield* listIssueNodes(target);
      const extras = issues.filter((issue) => !snapshot.issues.has(issue.number));
      if (extras.length === 0) break;
      for (const issue of extras) yield* retryBurst(deleteIssueNode(target, issue.id));
      yield* Effect.sleep("1000 millis");
    }
    const labels = yield* listLabelNames(target);
    for (const label of labels) if (!snapshot.labels.has(label)) yield* deleteLabel(target, label);
  });
}

/**
 * Re-runs `read` until `accept` holds, or fails after `timeoutMs`. GitHub's
 * issue reads — the REST label-filtered listing in particular — are eventually
 * consistent, so a write is not necessarily visible to the very next read; this
 * is how the suite waits that out rather than asserting an immediacy the real
 * API never promised. A read that fails is retried too, which is what lets an
 * `openMap` for a not-yet-listed map count as "not there yet".
 */
export function poll<A, E, R>(
  description: string,
  read: Effect.Effect<A, E, R>,
  accept: (value: A) => boolean,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Effect.Effect<A, WayfulError | E, R> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 1_500;
  return Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    let lastFailure: string | undefined;
    while (true) {
      const result = yield* Effect.result(read);
      if (Result.isSuccess(result) && accept(result.success)) return result.success;
      if (Result.isFailure(result))
        lastFailure =
          result.failure instanceof WayfulError ? result.failure.message : String(result.failure);
      if (Date.now() >= deadline) {
        const detail =
          lastFailure ?? "the read never produced a value that satisfied the condition";
        return yield* Effect.fail(
          new WayfulError({
            message: `timed out after ${timeoutMs}ms waiting for ${description}: ${detail}.`,
          }),
        );
      }
      yield* Effect.sleep(intervalMs);
    }
  });
}

/**
 * Retries an effect when GitHub's secondary (burst) rate limit rejects it,
 * waiting out the advised window. The live cap test issues hundreds of writes
 * and would otherwise flake on the burst limiter, which the production
 * transport deliberately surfaces rather than hides.
 */
export function retryBurst<A, R>(
  effect: Effect.Effect<A, WayfulError, R>,
  attempts = 4,
): Effect.Effect<A, WayfulError, R> {
  return Effect.gen(function* () {
    let last: WayfulError | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = yield* Effect.result(effect);
      if (Result.isSuccess(result)) return result.success;
      last = result.failure;
      if (!/secondary rate limit/i.test(last.message)) return yield* Effect.fail(last);
      yield* Effect.sleep("60 seconds");
    }
    return yield* Effect.fail(last!);
  });
}
