import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { Effect, Layer, Redacted } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";

import { GithubCredentials } from "../../../../src/backend/github/credentials";
import { GithubHttp } from "../../../../src/backend/github/http";
import { GithubMapStore } from "../../../../src/backend/github/mapStore";
import { MapStore } from "../../../../src/backend/MapStore";
import { ProjectStore } from "../../../../src/backend/ProjectStore";
import type { TypeDefinition } from "../../../../src/domain/model";
import { stubGithubHttp } from "./httpClient";
import { fakeSpawnFailure, stubChildProcessSpawner } from "./spawner";

export interface GithubHarnessOptions {
  /** `undefined` uses the default remote, `null` makes `git remote` fail. */
  readonly remote?: string | null;
  /** The type library the store's snapshot reads; empty unless a test supplies one. */
  readonly types?: readonly TypeDefinition[];
}

/** A `ProjectStore` stub: types are on disk in production, a fixed set in tests. */
function stubProjectStore(types: readonly TypeDefinition[]) {
  return Layer.succeed(
    ProjectStore,
    ProjectStore.of({
      initProject: () => Effect.void,
      openProject: () => Effect.die("ProjectStore.openProject is not used by the github store"),
      listTypes: () => Effect.succeed({ records: types, errors: [] }),
      getType: () => Effect.die("ProjectStore.getType is not used by the github store"),
    }),
  );
}

/**
 * The infrastructure a GitHub-backed operation needs: a stubbed `HttpClient`
 * (the only network seam) behind the real budgeted transport, a stubbed
 * `ChildProcessSpawner` for `git remote` and `gh auth token`, a fixed
 * credential, and the types the snapshot folds in. The Search API is actively
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
    stubGithubHttp((request) => {
      if (request.url.includes("/search/")) throw new Error("the Search API must never be called");
      return http(request);
    }),
    stubProjectStore(options.types ?? []),
    spawner,
    credentials,
    // `GithubMapStore.readArtifact` still resolves `file:` refs against the
    // local checkout, so its construction needs the same `FileSystem`/`Path`
    // services the filesystem backend closes over. Only those two — not the
    // full `BunServices.layer` — or its real `ChildProcessSpawner` would
    // shadow the stub above and the `git remote get-url` calls above would
    // hit the real process instead of `respond`.
    BunFileSystem.layer,
    BunPath.layer,
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
    GithubHttp | ChildProcessSpawner.ChildProcessSpawner | GithubCredentials
  >,
  options: GithubHarnessOptions = {},
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(githubInfra(http, options))));
}
