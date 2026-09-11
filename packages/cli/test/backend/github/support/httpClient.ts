import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { GithubHttp, makeGithubHttp } from "../../../../src/backend/github/http";

/**
 * A minimal `HttpClient` test double: every request is handed to `respond`,
 * which returns a Web `Response` synchronously. No real network I/O occurs.
 */
export function stubHttpClient(
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request))),
    ),
  );
}

/**
 * The budgeted `GithubHttp` transport wired to `respond`, so a test exercises
 * the same rate-limit observation and conditional-GET caching production uses.
 */
export function stubGithubHttp(
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
) {
  return Layer.effect(GithubHttp, Effect.flatMap(HttpClient.HttpClient, makeGithubHttp)).pipe(
    Layer.provide(stubHttpClient(respond)),
  );
}
