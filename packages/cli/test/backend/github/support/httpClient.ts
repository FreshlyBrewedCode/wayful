import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

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
