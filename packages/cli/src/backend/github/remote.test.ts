import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";

import { parseGitRemoteUrl, resolveOriginRemote } from "@backend/github/remote";
import { fakeSpawnFailure, stubChildProcessSpawner } from "@test/support/github/spawner";

describe("parseGitRemoteUrl", () => {
  test("parses the scp-like ssh form", () => {
    expect(parseGitRemoteUrl("git@github.com:acme/widgets.git")).toEqual(
      Option.some({ host: "github.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("parses the scp-like ssh form without a .git suffix", () => {
    expect(parseGitRemoteUrl("git@github.com:acme/widgets")).toEqual(
      Option.some({ host: "github.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("parses an explicit ssh:// URL", () => {
    expect(parseGitRemoteUrl("ssh://git@github.com/acme/widgets.git")).toEqual(
      Option.some({ host: "github.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("parses an https URL", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widgets.git")).toEqual(
      Option.some({ host: "github.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("parses an https URL without a .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widgets")).toEqual(
      Option.some({ host: "github.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("resolves an enterprise host from either form", () => {
    expect(parseGitRemoteUrl("git@github.example.com:acme/widgets.git")).toEqual(
      Option.some({ host: "github.example.com", owner: "acme", repo: "widgets" }),
    );
    expect(parseGitRemoteUrl("https://github.example.com/acme/widgets.git")).toEqual(
      Option.some({ host: "github.example.com", owner: "acme", repo: "widgets" }),
    );
  });

  test("rejects a remote that isn't owner/repo shaped", () => {
    expect(parseGitRemoteUrl("https://github.com/acme")).toEqual(Option.none());
    expect(parseGitRemoteUrl("not a url")).toEqual(Option.none());
    expect(parseGitRemoteUrl("")).toEqual(Option.none());
  });
});

describe("resolveOriginRemote", () => {
  test("parses the origin remote's URL when one is configured", async () => {
    const layer = stubChildProcessSpawner((invocation) => {
      expect(invocation).toEqual(["git", "remote", "get-url", "origin"]);
      return Effect.succeed("git@github.com:acme/widgets.git\n");
    });
    const result = await Effect.runPromise(resolveOriginRemote().pipe(Effect.provide(layer)));
    expect(result).toEqual(Option.some({ host: "github.com", owner: "acme", repo: "widgets" }));
  });

  test("resolves to none when there is no origin remote", async () => {
    const layer = stubChildProcessSpawner(() =>
      Effect.fail(fakeSpawnFailure("fatal: No such remote")),
    );
    const result = await Effect.runPromise(resolveOriginRemote().pipe(Effect.provide(layer)));
    expect(result).toEqual(Option.none());
  });

  test("resolves to none when git prints nothing", async () => {
    const layer = stubChildProcessSpawner(() => Effect.succeed("\n"));
    const result = await Effect.runPromise(resolveOriginRemote().pipe(Effect.provide(layer)));
    expect(result).toEqual(Option.none());
  });
});
