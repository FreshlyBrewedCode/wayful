import { describe, expect, test } from "bun:test";
import { Effect, Redacted } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import type { GitRemoteRef } from "../../../src/backend/github/remote";
import { readRevision } from "../../../src/backend/github/revision";
import { issueJson, jsonResponse } from "./support/issues";
import { runGithub } from "./support/store";

const repo: GitRemoteRef = { host: "github.com", owner: "acme", repo: "widgets" };
const token = Redacted.make("test-token");

interface Stub {
  mapsEtag: string;
  maps: readonly unknown[];
  childrenEtag: string;
  children: readonly unknown[];
  requests: { readonly url: string; readonly ifNoneMatch: string | undefined }[];
}

function revisionStub(): {
  stub: Stub;
  respond: (request: HttpClientRequest.HttpClientRequest) => Response;
} {
  const stub: Stub = {
    mapsEtag: "maps-v1",
    maps: [issueJson(10, { labels: [{ name: "wayful:map" }] })],
    childrenEtag: "children-v1",
    children: [issueJson(11, { labels: [{ name: "wayful:step" }] })],
    requests: [],
  };
  const respond = (request: HttpClientRequest.HttpClientRequest) => {
    const pathname = new URL(request.url).pathname;
    const ifNoneMatch = request.headers["if-none-match"];
    stub.requests.push({ url: request.url, ifNoneMatch });
    if (pathname === "/repos/acme/widgets/issues") {
      return ifNoneMatch === stub.mapsEtag
        ? new Response(null, { status: 304, headers: { etag: stub.mapsEtag } })
        : jsonResponse(200, stub.maps, { etag: stub.mapsEtag });
    }
    if (pathname.endsWith("/sub_issues")) {
      return ifNoneMatch === stub.childrenEtag
        ? new Response(null, { status: 304, headers: { etag: stub.childrenEtag } })
        : jsonResponse(200, stub.children, { etag: stub.childrenEtag });
    }
    throw new Error(`unexpected request: ${request.url}`);
  };
  return { stub, respond };
}

const read = () => readRevision(repo, token);

describe("readRevision: ETag polling without spending rate limit", () => {
  test("revalidates every read conditionally, and a quiet project yields the same token", async () => {
    const { stub, respond } = revisionStub();
    const tokens = await runGithub(
      respond,
      Effect.gen(function* () {
        const first = yield* read();
        const second = yield* read();
        return { first, second };
      }),
    );

    expect(tokens.first).toBe(tokens.second);
    // The second pass sends `If-None-Match` on both reads and is answered 304.
    expect(stub.requests.map((request) => request.ifNoneMatch)).toEqual([
      undefined,
      undefined,
      "maps-v1",
      "children-v1",
    ]);
  });

  test("a changed sub-issue changes the token", async () => {
    const { stub, respond } = revisionStub();
    const tokens = await runGithub(
      respond,
      Effect.gen(function* () {
        const first = yield* read();
        // The map's records changed server-side: a new sub-issue landed.
        stub.childrenEtag = "children-v2";
        stub.children = [
          issueJson(11, { labels: [{ name: "wayful:step" }] }),
          issueJson(12, { labels: [{ name: "wayful:step" }] }),
        ];
        const second = yield* read();
        return { first, second };
      }),
    );

    expect(tokens.first).not.toBe(tokens.second);
  });
});
