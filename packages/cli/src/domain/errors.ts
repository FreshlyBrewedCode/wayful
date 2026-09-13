import { Data } from "effect";

export class WayfulError extends Data.TaggedError("WayfulError")<{
  readonly message: string;
}> {}

export class MapMetadataError extends Data.TaggedError("MapMetadataError")<{
  readonly message: string;
}> {}

/**
 * Collapses a diagnosis onto one line. A backend can hand back a message with
 * embedded newlines (a GitHub error body, a multi-error decode); the contract
 * every surface renders is one `wayful:`-prefixed line per message, never a
 * paragraph or a stack trace.
 */
export function oneLine(message: string): string {
  return message.replace(/\s*\n\s*/g, " ").trim();
}
