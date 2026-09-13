import { describe, expect, test } from "bun:test";
import { Effect, Redacted } from "effect";

import type { GithubCredentials } from "@backend/github/credentials";
import { resolveRepo, resolveRepoRef } from "@backend/github/repo";
import type { ProjectHandle } from "@backend/ProjectStore";
import { fakeSpawnFailure, stubChildProcessSpawner } from "@test/support/github/spawner";

function project(overrides: Partial<ProjectHandle> = {}): ProjectHandle {
  return {
    root: "/projects/wayful",
    description: "",
    backend: "github",
    repo: "acme/widgets",
    ...overrides,
  };
}

describe("resolveRepoRef", () => {
  test("uses the host recorded in the project and never shells out to git", async () => {
    let gitCalls = 0;
    const layer = stubChildProcessSpawner((invocation) => {
      if (invocation[0] === "git") gitCalls++;
      return Effect.succeed("git@github.com:acme/widgets.git\n");
    });
    const ref = await Effect.runPromise(
      resolveRepoRef(project({ host: "github.example.com" })).pipe(Effect.provide(layer)),
    );
    expect(ref).toEqual({ host: "github.example.com", owner: "acme", repo: "widgets" });
    expect(gitCalls).toBe(0);
  });

  test("falls back to the git remote resolved in the project root, not the working directory", async () => {
    let cwd: string | undefined;
    const layer = stubChildProcessSpawner((invocation, options) => {
      expect(invocation).toEqual(["git", "remote", "get-url", "origin"]);
      cwd = options.cwd;
      return Effect.succeed("git@github.enterprise.test:acme/widgets.git\n");
    });
    const ref = await Effect.runPromise(
      resolveRepoRef(project({ root: "/elsewhere/checkout" })).pipe(Effect.provide(layer)),
    );
    expect(ref.host).toBe("github.enterprise.test");
    expect(cwd).toBe("/elsewhere/checkout");
  });

  test("defaults to github.com when no host is recorded and no remote resolves", async () => {
    const layer = stubChildProcessSpawner(() => Effect.fail(fakeSpawnFailure("no remote")));
    const ref = await Effect.runPromise(resolveRepoRef(project()).pipe(Effect.provide(layer)));
    expect(ref.host).toBe("github.com");
  });

  test("fails for a project that is not configured for github", async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        resolveRepoRef(project({ backend: "filesystem", repo: undefined })).pipe(
          Effect.provide(stubChildProcessSpawner(() => Effect.succeed(""))),
        ),
      ),
    );
    expect(result.message).toBe("project is not configured for the github backend.");
  });
});

describe("resolveRepo", () => {
  test("resolves the token against the project's recorded host", async () => {
    const requested: string[] = [];
    const credentials: GithubCredentials["Service"] = {
      resolve: () => Effect.die("not used"),
      token: (host) => {
        requested.push(host);
        return Effect.succeed(Redacted.make("test-token"));
      },
    };
    const resolved = await Effect.runPromise(
      resolveRepo(project({ host: "github.example.com" }), credentials).pipe(
        Effect.provide(stubChildProcessSpawner(() => Effect.succeed(""))),
      ),
    );
    expect(requested).toEqual(["github.example.com"]);
    expect(Redacted.value(resolved.token)).toBe("test-token");
  });
});
