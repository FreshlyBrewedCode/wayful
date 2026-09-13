import { Console, Effect } from "effect";

import { MapMetadataError, WayfulError } from "@domain/errors";
import type { DecodeError } from "@domain/model";
import { report } from "@cli/report";

export function printOutput(json: boolean, value: unknown, human: string): Effect.Effect<void> {
  return Console.log(json ? JSON.stringify(value, null, 2) : human);
}

/**
 * Renders decode errors as an explicit section — omitted entirely when there
 * are none, so degraded output is never confused with the ordinary case. Used
 * by every collection read that renders what decoded and names what did not.
 */
export function errorLines(errors: readonly DecodeError[]): string[] {
  return errors.length ? ["Errors:", ...errors.map((e) => `- ${e.file}: ${e.message}`)] : [];
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
