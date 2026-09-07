import { Console, Effect } from "effect";

import { MapMetadataError, WayfulError } from "../domain/errors";

export function printOutput(json: boolean, value: unknown, human: string): Effect.Effect<void> {
  return Console.log(json ? JSON.stringify(value, null, 2) : human);
}

/** Renders a Markdown body as the labelled, indented lines humans see. */
export function bodyLines(body: string, indent = ""): string[] {
  if (!body) return [`${indent}Body: (empty)`];
  const lines = body.split("\n").map((line) => `${indent}  ${line}`);
  return [`${indent}Body:`, ...lines];
}

/**
 * Wraps a command handler so any domain/backend failure prints `wayful:
 * <message>` on stderr, exits non-zero, and — when the command supports
 * `--json` — also emits `{"error": "<message>"}` on stdout. This is the
 * total `--json` failure contract: every command's JSON failures are shaped
 * the same way, not just `map validate`'s.
 */
export function handle<R>(
  json: boolean,
  effect: Effect.Effect<void, WayfulError | MapMetadataError, R>,
): Effect.Effect<void, never, R> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Console.error(`wayful: ${error.message}`);
        if (json) yield* Console.log(JSON.stringify({ error: error.message }));
        process.exitCode = 2;
      }),
    ),
  );
}
