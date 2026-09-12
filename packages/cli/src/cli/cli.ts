import { Command } from "effect/unstable/cli";

import { artifactCommand } from "./commands/artifact";
import { contextCommand } from "./commands/context";
import { goalCommand } from "./commands/goal";
import { initCommand } from "./commands/init";
import { labelCommand } from "./commands/label";
import { mapCommand } from "./commands/map";
import { serveCommand, uiCommand } from "./commands/server";
import { stepCommand } from "./commands/step";
import { typeCommand } from "./commands/type";
import { wayfulRoot } from "./root";

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
