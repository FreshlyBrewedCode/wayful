import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer, PlatformError, Redacted } from "effect";

import { GithubCredentials, GithubCredentialsLayer } from "@backend/github/credentials";
import { fakeSpawnFailure, stubChildProcessSpawner } from "@test/support/github/spawner";

const ENV_KEYS = ["WAYFUL_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function runWithSpawner<A, E>(
  effect: Effect.Effect<A, E, GithubCredentials>,
  respond: (invocation: readonly string[]) => Effect.Effect<string, PlatformError.PlatformError>,
) {
  const spawnerLayer = stubChildProcessSpawner(respond);
  return Effect.runPromise(
    effect.pipe(Effect.provide(GithubCredentialsLayer.pipe(Layer.provide(spawnerLayer)))),
  );
}

describe("GithubCredentials", () => {
  test("prefers WAYFUL_GITHUB_TOKEN over everything else", async () => {
    process.env.WAYFUL_GITHUB_TOKEN = "wayful-token";
    process.env.GH_TOKEN = "gh-token";
    process.env.GITHUB_TOKEN = "github-token";
    const token = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }),
      () => Effect.fail(fakeSpawnFailure("should not be called")),
    );
    expect(Redacted.value(token)).toBe("wayful-token");
  });

  test("falls back to GH_TOKEN when WAYFUL_GITHUB_TOKEN is unset", async () => {
    process.env.GH_TOKEN = "gh-token";
    process.env.GITHUB_TOKEN = "github-token";
    const token = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }),
      () => Effect.fail(fakeSpawnFailure("should not be called")),
    );
    expect(Redacted.value(token)).toBe("gh-token");
  });

  test("falls back to GITHUB_TOKEN when neither WAYFUL_GITHUB_TOKEN nor GH_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const token = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }),
      () => Effect.fail(fakeSpawnFailure("should not be called")),
    );
    expect(Redacted.value(token)).toBe("github-token");
  });

  test("falls back to `gh auth token --hostname <host>` when no env var is set", async () => {
    const token = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }),
      (invocation) => {
        expect(invocation).toEqual(["gh", "auth", "token", "--hostname", "github.com"]);
        return Effect.succeed("cli-token\n");
      },
    );
    expect(Redacted.value(token)).toBe("cli-token");
  });

  test("spawns `gh auth token` at most once per process for repeated lookups", async () => {
    let calls = 0;
    const token = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        const first = yield* credentials.token("github.com");
        const second = yield* credentials.token("github.com");
        return [first, second] as const;
      }).pipe(
        Effect.map(([first, second]) =>
          Redacted.value(first) === Redacted.value(second) ? first : second,
        ),
      ),
      () => {
        calls++;
        return Effect.succeed("cli-token\n");
      },
    );
    expect(Redacted.value(token)).toBe("cli-token");
    expect(calls).toBe(1);
  });

  test("fails with the exact missing-credentials message when nothing resolves", async () => {
    const result = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }).pipe(Effect.flip),
      () => Effect.succeed("\n"),
    );
    expect(result["_tag"]).toBe("WayfulError");
    expect(result.message).toBe("run 'gh auth login', or set GH_TOKEN");
  });

  test("fails with the exact missing-credentials message when `gh` itself fails", async () => {
    const result = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        return yield* credentials.token("github.com");
      }).pipe(Effect.flip),
      () => Effect.fail(fakeSpawnFailure("gh: command not found")),
    );
    expect(result["_tag"]).toBe("WayfulError");
    expect(result.message).toBe("run 'gh auth login', or set GH_TOKEN");
  });

  test("never includes the resolved token in the missing-credentials error, even when other hosts had one cached", async () => {
    const secret = "super-secret-token-value";
    const result = await runWithSpawner(
      Effect.gen(function* () {
        const credentials = yield* GithubCredentials;
        yield* credentials.token("github.com");
        return yield* credentials.token("github.example.com");
      }).pipe(Effect.flip),
      (invocation) =>
        invocation[invocation.length - 1] === "github.com"
          ? Effect.succeed(`${secret}\n`)
          : Effect.succeed("\n"),
    );
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result["_tag"]).toBe("WayfulError");
    expect(result.message).toBe("run 'gh auth login', or set GH_TOKEN");
  });
});
