import { describe, expect, test } from "bun:test";
import { Effect, Redacted } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import {
  addBlockedBy,
  apiBase,
  createIssue,
  ensureLabel,
  ensureLabels,
  listBlockedBy,
  listIssues,
  removeBlockedBy,
  verifyAccess,
} from "@backend/github/api";
import type { GitRemoteRef } from "@backend/github/remote";
import { stubGithubHttp } from "@test/support/github/httpClient";
import { ISSUE_TIME, bodyText, issueJson, jsonResponse } from "@test/support/github/issues";

const repo: GitRemoteRef = { host: "github.com", owner: "acme", repo: "widgets" };
const enterpriseRepo: GitRemoteRef = { host: "github.example.com", owner: "acme", repo: "widgets" };
const secretToken = Redacted.make("super-secret-token-value");

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
    const layer = stubGithubHttp((request) => {
      expect(request.url).toBe(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
      expect(request.headers["authorization"]).toBe(`Bearer ${Redacted.value(secretToken)}`);
      return jsonResponse(200, { permissions: { push: true } });
    });
    await Effect.runPromise(verifyAccess(repo, secretToken).pipe(Effect.provide(layer)));
  });

  test("uses the enterprise api/v3 base for a non-github.com host", async () => {
    const layer = stubGithubHttp((request) => {
      expect(request.url).toBe(
        `https://github.example.com/api/v3/repos/${enterpriseRepo.owner}/${enterpriseRepo.repo}`,
      );
      return jsonResponse(200, { permissions: { push: true } });
    });
    await Effect.runPromise(verifyAccess(enterpriseRepo, secretToken).pipe(Effect.provide(layer)));
  });

  test("fails without leaking the token when the token lacks push permission", async () => {
    const layer = stubGithubHttp(() => jsonResponse(200, { permissions: { push: false } }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });

  test("fails without leaking the token when the API rejects the token", async () => {
    const layer = stubGithubHttp(() => jsonResponse(401, { message: "Bad credentials" }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });

  test("fails without leaking the token when the repo is not found or not visible", async () => {
    const layer = stubGithubHttp(() => jsonResponse(404, { message: "Not Found" }));
    const error = await Effect.runPromise(
      verifyAccess(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});

describe("ensureLabel", () => {
  test("succeeds when the label is created", async () => {
    const layer = stubGithubHttp((request) => {
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
    const layer = stubGithubHttp(() => jsonResponse(422, { message: "already_exists" }));
    await Effect.runPromise(
      ensureLabel(repo, secretToken, {
        name: "wayful:map",
        color: "1D76DB",
        description: "A wayful map",
      }).pipe(Effect.provide(layer)),
    );
  });

  test("fails without leaking the token on an unexpected status", async () => {
    const layer = stubGithubHttp(() => jsonResponse(500, { message: "server error" }));
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
    const layer = stubGithubHttp((request) => {
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

describe("listIssues", () => {
  test("requests label-filtered open issues and normalizes labels", async () => {
    let seen = "";
    const layer = stubGithubHttp((request) => {
      seen = request.url;
      return jsonResponse(200, [issueJson(7), issueJson(8, { labels: ["wayful:step"] })]);
    });
    const issues = await Effect.runPromise(
      listIssues(repo, secretToken, { labels: ["wayful:map"] }).pipe(Effect.provide(layer)),
    );
    const url = new URL(seen);
    expect(url.pathname).toBe("/repos/acme/widgets/issues");
    expect(url.searchParams.get("labels")).toBe("wayful:map");
    expect(url.searchParams.get("state")).toBe("open");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(issues).toEqual([
      {
        id: 1007,
        number: 7,
        title: "issue 7",
        body: "body",
        state: "open",
        state_reason: null,
        labels: ["wayful:map"],
        created_at: ISSUE_TIME,
        updated_at: ISSUE_TIME,
        closed_at: null,
      },
      {
        id: 1008,
        number: 8,
        title: "issue 8",
        body: "body",
        state: "open",
        state_reason: null,
        labels: ["wayful:step"],
        created_at: ISSUE_TIME,
        updated_at: ISSUE_TIME,
        closed_at: null,
      },
    ]);
  });

  test("normalizes GitHub's second-precision timestamps to the canonical millisecond shape", async () => {
    const layer = stubGithubHttp(() =>
      jsonResponse(200, [
        issueJson(7, {
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T12:30:45Z",
          closed_at: "2026-01-03T23:59:59Z",
        }),
      ]),
    );
    const issues = await Effect.runPromise(
      listIssues(repo, secretToken).pipe(Effect.provide(layer)),
    );
    expect(issues[0]).toMatchObject({
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T12:30:45.000Z",
      closed_at: "2026-01-03T23:59:59.000Z",
    });
  });

  test("drops pull requests, which the issues endpoint also lists", async () => {
    const layer = stubGithubHttp(() =>
      jsonResponse(200, [issueJson(7), issueJson(9, { pull_request: { url: "..." } })]),
    );
    const issues = await Effect.runPromise(
      listIssues(repo, secretToken).pipe(Effect.provide(layer)),
    );
    expect(issues.map((issue) => issue.number)).toEqual([7]);
  });

  test("follows rel=next pagination", async () => {
    const requested: string[] = [];
    const layer = stubGithubHttp((request) => {
      requested.push(request.url);
      if (request.url.includes("page=2")) return jsonResponse(200, [issueJson(2)]);
      return new Response(JSON.stringify([issueJson(1)]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/acme/widgets/issues?page=2>; rel="next", <https://api.github.com/repos/acme/widgets/issues?page=2>; rel="last"',
        },
      });
    });
    const issues = await Effect.runPromise(
      listIssues(repo, secretToken).pipe(Effect.provide(layer)),
    );
    expect(issues.map((issue) => issue.number)).toEqual([1, 2]);
    expect(requested).toHaveLength(2);
  });

  test("fails without leaking the token on an unexpected status", async () => {
    const layer = stubGithubHttp(() => jsonResponse(500, { message: "server error" }));
    const error = await Effect.runPromise(
      listIssues(repo, secretToken).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});

describe("createIssue", () => {
  test("posts the title, body and labels and returns the created issue", async () => {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const layer = stubGithubHttp((request) => {
      seen = request;
      return jsonResponse(201, issueJson(11, { title: "here" }));
    });
    const created = await Effect.runPromise(
      createIssue(repo, secretToken, {
        title: "here",
        body: "the body",
        labels: ["wayful:map"],
      }).pipe(Effect.provide(layer)),
    );
    expect(created.number).toBe(11);
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("https://api.github.com/repos/acme/widgets/issues");
    expect(JSON.parse(bodyText(seen!))).toEqual({
      title: "here",
      body: "the body",
      labels: ["wayful:map"],
    });
  });

  test("fails without leaking the token when the issue cannot be created", async () => {
    const layer = stubGithubHttp(() => jsonResponse(422, { message: "validation failed" }));
    const error = await Effect.runPromise(
      createIssue(repo, secretToken, { title: "here", body: "", labels: [] }).pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});

describe("issue dependencies", () => {
  test("listBlockedBy reads the issue's native blocked_by edges", async () => {
    let seen = "";
    const layer = stubGithubHttp((request) => {
      seen = request.url;
      return jsonResponse(200, [issueJson(3, { id: 1003 }), issueJson(5, { id: 1005 })]);
    });
    const blockedBy = await Effect.runPromise(
      listBlockedBy(repo, secretToken, 7).pipe(Effect.provide(layer)),
    );
    expect(new URL(seen).pathname).toBe("/repos/acme/widgets/issues/7/dependencies/blocked_by");
    expect(blockedBy.map((issue) => issue.number)).toEqual([3, 5]);
  });

  test("addBlockedBy posts the blocking issue's database id", async () => {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const layer = stubGithubHttp((request) => {
      seen = request;
      return jsonResponse(201, {});
    });
    await Effect.runPromise(addBlockedBy(repo, secretToken, 7, 1003).pipe(Effect.provide(layer)));
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe(
      "https://api.github.com/repos/acme/widgets/issues/7/dependencies/blocked_by",
    );
    expect(JSON.parse(bodyText(seen!))).toEqual({ issue_id: 1003 });
  });

  test("removeBlockedBy deletes the edge by the blocking issue's database id", async () => {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const layer = stubGithubHttp((request) => {
      seen = request;
      return jsonResponse(200, {});
    });
    await Effect.runPromise(
      removeBlockedBy(repo, secretToken, 7, 1003).pipe(Effect.provide(layer)),
    );
    expect(seen?.method).toBe("DELETE");
    expect(seen?.url).toBe(
      "https://api.github.com/repos/acme/widgets/issues/7/dependencies/blocked_by/1003",
    );
  });

  test("a failed dependency mutation is a WayfulError that does not leak the token", async () => {
    const layer = stubGithubHttp(() => jsonResponse(403, { message: "Forbidden" }));
    const error = await Effect.runPromise(
      addBlockedBy(repo, secretToken, 7, 1003).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error["_tag"]).toBe("WayfulError");
    expect(error.message).not.toContain(Redacted.value(secretToken));
  });
});
