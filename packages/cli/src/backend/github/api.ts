import { Effect, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { WayfulError } from "../../domain/errors";
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
