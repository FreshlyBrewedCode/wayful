import { describe, expect, test } from "bun:test";
import { Effect, Redacted } from "effect";

import { apiBase, ensureLabel, ensureLabels, verifyAccess } from "../../../src/backend/github/api";
import type { GitRemoteRef } from "../../../src/backend/github/remote";
import { stubHttpClient } from "./support/httpClient";

const repo: GitRemoteRef = { host: "github.com", owner: "acme", repo: "widgets" };
const enterpriseRepo: GitRemoteRef = { host: "github.example.com", owner: "acme", repo: "widgets" };
const secretToken = Redacted.make("super-secret-token-value");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiBase", () => {
  test("resolves github.com to the public API hosts", () => {
    expect(apiBase("github.com")).toEqual({
      rest: "https://api.github.com",
      graphql: "https://api.github.com/graphql",
    });
  });

  test("resolves an enterprise host to its api/v3 and api/graphql paths", () => {
    expect(apiBase("github.example.com")).toEqual({
      rest: "https://github.example.com/api/v3",
      graphql: "https://github.example.com/api/graphql",
    });
  });
});

describe("verifyAccess", () => {
  test("succeeds when the repo response grants push permission", async () => {
    const layer = stubHttpClient((request) => {
      expect(request.url).toBe(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
      expect(request.headers["authorization"]).toBe(`Bearer ${Redacted.value(secretToken)}`);
      return jsonResponse(200, { permissions: { push: true } });
    });
    await Effect.runPromise(verifyAccess(repo, secretToken).pipe(Effect.provide(layer)));
  });

  test("uses the enterprise api/v3 base for a non-github.com host", async () => {
    const layer = stubHttpClient((request) => {
      expect(request.url).toBe(
        `https://github.example.com/api/v3/repos/${enterpriseRepo.owner}/${enterpriseRepo.repo}`,
      );
      return jsonResponse(200, { permissions: { push: true } });
    });
    await Effect.runPromise(verifyAccess(enterpriseRepo, secretToken).pipe(Effect.provide(layer)));
  });

  test("fails without leaking the token when the token lacks push permission", async () => {
    const layer = stubHttpClient(() => jsonResponse(200, { permissions: { push: false } }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });

  test("fails without leaking the token when the API rejects the token", async () => {
    const layer = stubHttpClient(() => jsonResponse(401, { message: "Bad credentials" }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });

  test("fails without leaking the token when the repo is not found or not visible", async () => {
    const layer = stubHttpClient(() => jsonResponse(404, { message: "Not Found" }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});

describe("ensureLabel", () => {
  test("succeeds when the label is created", async () => {
    const layer = stubHttpClient((request) => {
      expect(request.url).toBe(`https://api.github.com/repos/${repo.owner}/${repo.repo}/labels`);
      return jsonResponse(201, { name: "wayful:map" });
    });
    await Effect.runPromise(
      ensureLabel(repo, secretToken, {
        name: "wayful:map",
        color: "1D76DB",
        description: "A wayful map",
      }).pipe(Effect.provide(layer)),
    );
  });

  test("treats an already-exists 422 as success", async () => {
    const layer = stubHttpClient(() => jsonResponse(422, { message: "already_exists" }));
    await Effect.runPromise(
      ensureLabel(repo, secretToken, {
        name: "wayful:map",
        color: "1D76DB",
        description: "A wayful map",
      }).pipe(Effect.provide(layer)),
    );
  });

  test("fails without leaking the token on an unexpected status", async () => {
    const layer = stubHttpClient(() => jsonResponse(500, { message: "server error" }));
    const error = await Effect.runPromise(
      ensureLabel(repo, secretToken, {
        name: "wayful:map",
        color: "1D76DB",
        description: "A wayful map",
      }).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});

describe("ensureLabels", () => {
  test("creates every label", async () => {
    const created: string[] = [];
    const layer = stubHttpClient((request) => {
      created.push(request.url);
      return jsonResponse(201, {});
    });
    await Effect.runPromise(
      ensureLabels(repo, secretToken, [
        { name: "wayful:map", color: "1D76DB", description: "A wayful map" },
        { name: "wayful:step", color: "0E8A16", description: "A wayful step" },
      ]).pipe(Effect.provide(layer)),
    );
    expect(created).toHaveLength(2);
  });
});
