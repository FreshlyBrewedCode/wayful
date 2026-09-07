import { Command } from "effect/unstable/cli";

import { projectFlag } from "./flags";

/**
 * The root `wayful` command, exported separately from cli.ts so leaf command
 * modules can `yield* wayfulRoot` to read the shared `--project` flag without
 * a circular import against cli.ts (which imports every command module to
 * assemble the final subcommand tree).
 */
export const wayfulRoot = Command.make("wayful").pipe(
  Command.withSharedFlags({ project: projectFlag }),
  Command.withDescription("Wayful filesystem CLI"),
);
