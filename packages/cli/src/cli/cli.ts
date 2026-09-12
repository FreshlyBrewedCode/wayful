import { Command } from "effect/unstable/cli";

import { artifactCommand } from "@cli/commands/artifact";
import { contextCommand } from "@cli/commands/context";
import { goalCommand } from "@cli/commands/goal";
import { initCommand } from "@cli/commands/init";
import { labelCommand } from "@cli/commands/label";
import { mapCommand } from "@cli/commands/map";
import { serveCommand, uiCommand } from "@cli/commands/server";
import { stepCommand } from "@cli/commands/step";
import { typeCommand } from "@cli/commands/type";
import { wayfulRoot } from "@cli/root";

export const cli = wayfulRoot.pipe(
  Command.withSubcommands([
    initCommand,
    contextCommand,
    mapCommand,
    stepCommand,
    artifactCommand,
    goalCommand,
    typeCommand,
    labelCommand,
    uiCommand,
    serveCommand,
  ]),
);
