import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { HttpClientRequest } from "effect/unstable/http";

import {
  GithubHttp,
  GithubHttpLayer,
  classifyRateLimit,
  readRateLimit,
  RATE_LIMIT_FLOOR,
} from "@backend/github/http";
import { stubHttpClient } from "@test/support/github/httpClient";
import { jsonResponse } from "@test/support/github/issues";

const url = "https://api.github.com/repos/acme/widgets/issues/1";

function run<A, E>(
  respond: Parameters<typeof stubHttpClient>[0],
  effect: Effect.Effect<A, E, GithubHttp>,
): Promise<A> {
  const layer = GithubHttpLayer.pipe(Layer.provide(stubHttpClient(respond)));
  return Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
}

describe("readRateLimit", () => {
  test("reads the budget GitHub reports", () => {
    expect(
      readRateLimit({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1700000000",
        "x-ratelimit-resource": "graphql",
      }),
    ).toEqual({ limit: 5000, remaining: 4999, reset: 1700000000, resource: "graphql" });
  });

  test("is absent when the response reports no budget", () => {
    expect(readRateLimit({})).toBeUndefined();
  });
});

describe("classifyRateLimit", () => {
  test("reads an exhausted primary limit from a 403", () => {
    const error = classifyRateLimit(
      403,
      { "x-ratelimit-remaining": "0" },
      "API rate limit exceeded",
    );
    expect(error?.message).toContain("rate limit exceeded");
  });

  test("reads a secondary limit from a retry-after header", () => {
    const error = classifyRateLimit(
      403,
      { "retry-after": "60" },
      "You have exceeded a secondary rate limit",
    );
    expect(error?.message).toContain("secondary rate limit");
    expect(error?.message).toContain("60 seconds");
  });

  test("leaves a permissions 403 alone", () => {
    expect(classifyRateLimit(403, {}, "Resource not accessible by integration")).toBeUndefined();
  });
});

describe("GithubHttp: conditional GETs", () => {
  test("sends If-None-Match on a repeat and serves the cached body on 304", async () => {
    const seen: Array<string | undefined> = [];
    const value = await run(
      (request) => {
        seen.push(request.headers["if-none-match"]);
        if (seen.length === 1)
          return new Response(JSON.stringify({ n: 1 }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              etag: '"v1"',
              "x-ratelimit-remaining": "100",
              "x-ratelimit-limit": "5000",
            },
          });
        return new Response(null, { status: 304 });
      },
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        const first = yield* http.getJson(HttpClientRequest.get(url));
        const second = yield* http.getJson(HttpClientRequest.get(url));
        return { first: first.value, second: second.value };
      }),
    );
    expect(seen).toEqual([undefined, '"v1"']);
    expect(value).toEqual({ first: { n: 1 }, second: { n: 1 } });
  });

  test("a 304 does not decrement the observed remaining budget", async () => {
    const remaining = await run(
      (request) => {
        if (request.headers["if-none-match"] === undefined)
          return new Response(JSON.stringify({ n: 1 }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              etag: '"v1"',
              "x-ratelimit-remaining": "100",
              "x-ratelimit-limit": "5000",
            },
          });
        // A real 304 carries no rate-limit headers; assert the budget is kept.
        return new Response(null, { status: 304 });
      },
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        yield* http.getJson(HttpClientRequest.get(url));
        yield* http.getJson(HttpClientRequest.get(url));
        return Option.getOrUndefined(yield* http.rateLimit);
      }),
    );
    expect(remaining).toEqual({ limit: 5000, remaining: 100, reset: 0, resource: "core" });
  });
});

describe("GithubHttp: rate-limit budgeting", () => {
  test("translates an exhausted primary limit into a clear operational error", async () => {
    const error = await run(
      () =>
        jsonResponse(
          403,
          { message: "API rate limit exceeded for user ID 1." },
          {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-reset": "1700000000",
          },
        ),
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        return yield* Effect.flip(http.execute(HttpClientRequest.get(url)));
      }),
    );
    expect(error.message).toContain("rate limit exceeded");
    expect(error.message).toContain("2023-11-14");
  });

  test("handles a secondary limit distinctly from a primary one", async () => {
    const error = await run(
      () =>
        jsonResponse(
          403,
          { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
          { "retry-after": "60" },
        ),
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        return yield* Effect.flip(http.execute(HttpClientRequest.get(url)));
      }),
    );
    expect(error.message).toContain("secondary rate limit");
    expect(error.message).toContain("60 seconds");
  });

  test("fails the next request before hitting GitHub when the budget is nearly exhausted", async () => {
    let calls = 0;
    const error = await run(
      () => {
        calls += 1;
        return jsonResponse(
          200,
          { ok: true },
          {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": String(RATE_LIMIT_FLOOR),
          },
        );
      },
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        yield* http.getJson(HttpClientRequest.get(url));
        return yield* Effect.flip(http.getJson(HttpClientRequest.get(`${url}?page=2`)));
      }),
    );
    expect(calls).toBe(1);
    expect(error.message).toContain("nearly exhausted");
  });
});

describe("makeGithubHttp", () => {
  test("does not classify a generic 403 as a rate limit", async () => {
    const result = await run(
      () => jsonResponse(403, { message: "Forbidden" }),
      Effect.gen(function* () {
        const http = yield* GithubHttp;
        const response = yield* http.execute(HttpClientRequest.get(url));
        return { status: response.status, body: yield* response.json };
      }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ message: "Forbidden" });
  });
});
