import { DateTime, Effect } from "effect";

import { WayfulError } from "@domain/errors";

/**
 * The current instant as an ISO-8601 UTC timestamp, sourced from the Effect
 * runtime clock so backend and domain tests can inject a fixed clock (e.g.
 * via `TestClock`) rather than reading the wall clock directly.
 */
export const nowISO: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

/** Lifts a domain helper that throws `WayfulError` synchronously into an Effect. */
export function liftSync<A>(thunk: () => A): Effect.Effect<A, WayfulError> {
  return Effect.try({
    try: thunk,
    catch: (error) =>
      error instanceof WayfulError ? error : new WayfulError({ message: String(error) }),
  });
}
