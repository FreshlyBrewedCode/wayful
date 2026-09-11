import { Effect, Layer, Redacted } from "effect";
import { HttpClient, type HttpClientRequest } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";

import { GithubCredentials } from "../../../../src/backend/github/credentials";
import { GithubMapStore } from "../../../../src/backend/github/mapStore";
import { MapStore } from "../../../../src/backend/MapStore";
import { stubHttpClient } from "./httpClient";
import { fakeSpawnFailure, stubChildProcessSpawner } from "./spawner";

export interface GithubHarnessOptions {
  /** `undefined` uses the default remote, `null` makes `git remote` fail. */
  readonly remote?: string | null;
}

/**
 * The infrastructure a GitHub-backed operation needs: a stubbed `HttpClient`
 * (the only network seam), a stubbed `ChildProcessSpawner` for `git remote` and
 * `gh auth token`, and a fixed credential. The Search API is actively
 * forbidden: any request to `/search/` throws, which is what makes the "never
 * the Search API" contract a real guard rather than a comment.
 */
export function githubInfra(
  http: (request: HttpClientRequest.HttpClientRequest) => Response,
  options: GithubHarnessOptions = {},
) {
  const remote = options.remote === undefined ? "git@github.com:acme/widgets.git" : options.remote;
  const spawner = stubChildProcessSpawner((invocation) => {
    if (invocation[0] === "git")
      return remote === null ? Effect.fail(fakeSpawnFailure("no remote")) : Effect.succeed(remote);
    return Effect.succeed("");
  });
  const credentials = Layer.succeed(
    GithubCredentials,
    GithubCredentials.of({ token: () => Effect.succeed(Redacted.make("test-token")) }),
  );
  return Layer.mergeAll(
    stubHttpClient((request) => {
      if (request.url.includes("/search/")) throw new Error("the Search API must never be called");
      return http(request);
    }),
    spawner,
    credentials,
  );
}

/** Runs `effect` against `GithubMapStore` wired to the stubbed infrastructure. */
export function runGithubMapStore<A, E>(
  http: (request: HttpClientRequest.HttpClientRequest) => Response,
  effect: Effect.Effect<A, E, MapStore>,
  options: GithubHarnessOptions = {},
): Promise<A> {
  const layer = GithubMapStore.pipe(Layer.provide(githubInfra(http, options)));
  return Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
}

/** Runs `effect` against the stubbed GitHub infrastructure directly. */
export function runGithub<A, E>(
  http: (request: HttpClientRequest.HttpClientRequest) => Response,
  effect: Effect.Effect<
    A,
    E,
    HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner | GithubCredentials
  >,
  options: GithubHarnessOptions = {},
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(githubInfra(http, options))));
}
