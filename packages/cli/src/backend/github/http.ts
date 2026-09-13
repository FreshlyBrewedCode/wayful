import { Context, Data, DateTime, Duration, Effect, Layer, Option, Ref } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { WayfulError } from "@domain/errors";
import { GithubCache } from "@backend/github/cache";

/**
 * The number of remaining requests below which wayful stops issuing them and
 * fails with a clear operational error. GitHub answers a request made at zero
 * with a raw `403`; observing the budget lets wayful say why before that.
 */
export const RATE_LIMIT_FLOOR = 5;

/**
 * How many times a burst-limited request is retried before wayful gives up. The
 * waits back off exponentially and honor GitHub's `retry-after` when it sends
 * one, so a burst of writes drains rather than tripping the secondary limit.
 */
export const SECONDARY_RATE_LIMIT_ATTEMPTS = 5;
const SECONDARY_RATE_LIMIT_BASE_MS = 1_000;
const SECONDARY_RATE_LIMIT_CAP_MS = 30_000;

/** The subset of GitHub's rate-limit headers wayful budgets against. */
export interface RateLimit {
  readonly limit: number;
  readonly remaining: number;
  /** The epoch-second reset instant GitHub reports. */
  readonly reset: number;
  readonly resource: string;
}

export interface JsonRead {
  /** The parsed response body, or the cached body revalidated with a `304`. */
  readonly value: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface GithubHttpService {
  /** Executes any request, observing rate-limit headers, translating limit responses into clear errors, and backing off a burst limit. */
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, WayfulError>;
  /**
   * A conditional `GET` whose parsed body is cached. A repeat sends
   * `If-None-Match`; a `304` serves the cached value without re-parsing it or
   * spending rate-limit budget. The cache outlives the process when a
   * filesystem-backed `GithubCache` is provided.
   */
  readonly getJson: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<JsonRead, WayfulError>;
  /** The last rate-limit budget observed, for budgeting and for tests. */
  readonly rateLimit: Effect.Effect<Option.Option<RateLimit>>;
}

export class GithubHttp extends Context.Service<GithubHttp, GithubHttpService>()(
  "wayful/GithubHttp",
) {}

export function requestFailed(reason: string): WayfulError {
  return new WayfulError({ message: `github api request failed: ${reason}` });
}

function headerInt(headers: Readonly<Record<string, string>>, name: string): number | undefined {
  const raw = headers[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

/** Reads the rate-limit budget a response reports, if it reports one. */
export function readRateLimit(headers: Readonly<Record<string, string>>): RateLimit | undefined {
  const limit = headerInt(headers, "x-ratelimit-limit");
  const remaining = headerInt(headers, "x-ratelimit-remaining");
  if (limit === undefined || remaining === undefined) return undefined;
  return {
    limit,
    remaining,
    reset: headerInt(headers, "x-ratelimit-reset") ?? 0,
    resource: headers["x-ratelimit-resource"] ?? "core",
  };
}

function resetTime(budget: RateLimit): string {
  return budget.reset > 0
    ? DateTime.formatIso(DateTime.makeUnsafe(budget.reset * 1000))
    : "the next reset window";
}

/** The clear error the budget produces before GitHub answers with a raw `403`. */
export function rateLimitError(budget: RateLimit): WayfulError {
  return new WayfulError({
    message: `github ${budget.resource} rate limit is nearly exhausted (${budget.remaining} of ${budget.limit} requests remain, resetting at ${resetTime(budget)}); wait for the reset before retrying.`,
  });
}

/** The distinct error a secondary (burst) limit produces, with its retry advice. */
export function secondaryRateLimitError(retryAfter: string | undefined): WayfulError {
  const wait =
    retryAfter !== undefined
      ? `retry after ${retryAfter} seconds`
      : "wait a minute before retrying";
  return new WayfulError({
    message: `github secondary rate limit exceeded on rapid requests; ${wait}. Wayful avoids rapid bursts of writes.`,
  });
}

function primaryRateLimitError(headers: Readonly<Record<string, string>>): WayfulError {
  const reset = headerInt(headers, "x-ratelimit-reset");
  const resource = headers["x-ratelimit-resource"] ?? "core";
  const when =
    reset !== undefined
      ? DateTime.formatIso(DateTime.makeUnsafe(reset * 1000))
      : "the next reset window";
  return new WayfulError({
    message: `github ${resource} rate limit exceeded; wait until ${when} before retrying.`,
  });
}

function messageOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed?.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

/**
 * Classifies a `403`/`429` as a primary or secondary rate limit. A primary
 * limit is exhausted budget; a secondary one is a burst (`retry-after`, an
 * explicit message, or a `429`). Anything else — a permissions `403`, say — is
 * left for the caller to report in its own terms.
 */
export function classifyRateLimit(
  status: number,
  headers: Readonly<Record<string, string>>,
  message: string,
): WayfulError | undefined {
  if (status !== 403 && status !== 429) return undefined;
  const retryAfter = headers["retry-after"];
  if (status === 429 || retryAfter !== undefined || /secondary rate limit/i.test(message))
    return secondaryRateLimitError(retryAfter);
  if (headerInt(headers, "x-ratelimit-remaining") === 0) return primaryRateLimitError(headers);
  return undefined;
}

/** The wait before retrying a burst-limited request: the larger of exponential backoff and GitHub's own `retry-after`, capped. */
export function secondaryRetryDelay(
  attempt: number,
  retryAfterSeconds?: number,
): Duration.Duration {
  const exponential = SECONDARY_RATE_LIMIT_BASE_MS * 2 ** attempt;
  const instructed = retryAfterSeconds !== undefined ? retryAfterSeconds * 1_000 : 0;
  return Duration.millis(Math.min(Math.max(exponential, instructed), SECONDARY_RATE_LIMIT_CAP_MS));
}

/** Internal signal that a request hit GitHub's burst limit and should be retried. */
class SecondaryLimit extends Data.TaggedError("SecondaryLimit")<{
  readonly retryAfterSeconds?: number;
}> {}

function rebuild(
  request: HttpClientRequest.HttpClientRequest,
  response: HttpClientResponse.HttpClientResponse,
  body: string,
): HttpClientResponse.HttpClientResponse {
  return HttpClientResponse.fromWeb(
    request,
    new Response(body, { status: response.status, headers: response.headers }),
  );
}

/**
 * The GitHub-aware HTTP seam. Every request flows through here so rate-limit
 * headers are observed in one place, burst limits back off instead of failing,
 * and conditional `GET`s are revalidated with `If-None-Match` against the
 * provided cache.
 */
export function makeGithubHttp(
  client: HttpClient.HttpClient,
): Effect.Effect<GithubHttpService, never, GithubCache> {
  return Effect.gen(function* () {
    const cache = yield* GithubCache;
    const observed = yield* Ref.make(Option.none<RateLimit>());

    const executeOnce = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const budget = yield* Ref.get(observed);
        if (Option.isSome(budget) && budget.value.remaining <= RATE_LIMIT_FLOOR)
          return yield* rateLimitError(budget.value);

        const response = yield* client
          .execute(request)
          .pipe(Effect.mapError((error) => requestFailed(error.message)));

        // A 304 is GitHub's own way of saying "nothing changed, this is free":
        // it neither carries a body nor spends budget, so leave both alone.
        if (response.status === 304) return response;

        const next = readRateLimit(response.headers);
        if (next !== undefined) yield* Ref.set(observed, Option.some(next));

        if (response.status === 403 || response.status === 429) {
          const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
          const message = messageOf(text);
          const retryAfter = headerInt(response.headers, "retry-after");
          if (
            response.status === 429 ||
            response.headers["retry-after"] !== undefined ||
            /secondary rate limit/i.test(message)
          )
            return yield* new SecondaryLimit({ retryAfterSeconds: retryAfter });
          const limit = classifyRateLimit(response.status, response.headers, message);
          if (limit !== undefined) return yield* limit;
          // Not a rate limit: hand the response back intact for the caller.
          return rebuild(request, response, text);
        }
        return response;
      });

    const attempt = (
      request: HttpClientRequest.HttpClientRequest,
      attemptNumber: number,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, WayfulError> =>
      executeOnce(request).pipe(
        Effect.catchIf(
          (error): error is SecondaryLimit => error instanceof SecondaryLimit,
          (error) =>
            attemptNumber + 1 >= SECONDARY_RATE_LIMIT_ATTEMPTS
              ? Effect.fail(secondaryRateLimitError(error.retryAfterSeconds?.toString()))
              : Effect.sleep(secondaryRetryDelay(attemptNumber, error.retryAfterSeconds)).pipe(
                  Effect.andThen(attempt(request, attemptNumber + 1)),
                ),
        ),
      );

    const execute = (request: HttpClientRequest.HttpClientRequest) => attempt(request, 0);

    const getJson = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const url = request.url;
        const cached = yield* cache.read(url);
        const conditional = Option.isNone(cached)
          ? request
          : HttpClientRequest.setHeader(request, "if-none-match", cached.value.etag);

        const response = yield* execute(conditional);
        if (response.status === 304 && Option.isSome(cached))
          return { value: cached.value.value, headers: cached.value.headers };
        if (response.status < 200 || response.status >= 300)
          return yield* requestFailed(`unexpected status ${response.status}.`);

        const value = yield* response.json.pipe(
          Effect.mapError((error) => requestFailed(error.message)),
        );
        const headers = response.headers;
        const read = { value, headers };
        const etag = headers["etag"];
        if (etag !== undefined && etag !== "") yield* cache.write(url, { etag, value, headers });
        return read;
      });

    return { execute, getJson, rateLimit: Ref.get(observed) };
  });
}

/** The shared GitHub transport, layered over the ambient `HttpClient` and `GithubCache`. */
export const GithubHttpLayer = Layer.effect(
  GithubHttp,
  Effect.flatMap(HttpClient.HttpClient, makeGithubHttp),
);
