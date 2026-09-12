import { Console, Effect } from "effect";

import { MapMetadataError, WayfulError } from "@domain/errors";
import { report } from "@cli/report";

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
 * Wraps a command handler so any domain/backend failure reports through the
 * shared `wayful: `/`--json`/exit-code contract in `report.ts` — the same
 * one `main.ts` uses for parse-stage failures, so every command's failure is
 * shaped the same way regardless of which stage rejected it.
 */
export function handle<R>(
  json: boolean,
  effect: Effect.Effect<void, WayfulError | MapMetadataError, R>,
): Effect.Effect<void, never, R> {
  return effect.pipe(Effect.catch((error) => report({ json, message: error.message })));
}
