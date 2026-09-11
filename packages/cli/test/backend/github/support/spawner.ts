import { Effect, Layer, PlatformError, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { Command } from "effect/unstable/process/ChildProcess";

const notImplemented = () => Effect.die(new Error("not stubbed"));
const streamNotImplemented = () => Stream.die(new Error("not stubbed"));

const commandOf = (command: Command): readonly string[] =>
  command["_tag"] === "StandardCommand" ? [command.command, ...command.args] : [];

/** A fake failure a stubbed command can return, mirroring a real spawn failure. */
export const fakeSpawnFailure = (description: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "Command",
    method: "spawn",
    description,
  });

/**
 * A `ChildProcessSpawner` test double whose only implemented surface is
 * `string`, driven by `respond`; every other method dies if a test
 * accidentally exercises it. `respond` receives the joined `[command, ...args]`
 * so callers can match on the exact invocation.
 */
export function stubChildProcessSpawner(
  respond: (invocation: readonly string[]) => Effect.Effect<string, PlatformError.PlatformError>,
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.ChildProcessSpawner.of({
      spawn: notImplemented,
      exitCode: notImplemented,
      streamString: streamNotImplemented,
      streamLines: streamNotImplemented,
      lines: notImplemented,
      string: (command) => respond(commandOf(command)),
    }),
  );
}
