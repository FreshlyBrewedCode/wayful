import { Command } from "effect/unstable/cli";

import {
  stepCreateCommand,
  stepShowCommand,
  stepUpdateCommand,
} from "@cli/commands/step/create-show-update";
import {
  stepBlockCommand,
  stepCancelCommand,
  stepCompleteCommand,
  stepUnblockCommand,
} from "@cli/commands/step/lifecycle";
import {
  stepDependsCommand,
  stepInputCommand,
  stepOutputCommand,
} from "@cli/commands/step/relations";
import { stepParent } from "@cli/commands/step/shared";

export const stepCommand = stepParent.pipe(
  Command.withSubcommands([
    stepCreateCommand,
    stepShowCommand,
    stepUpdateCommand,
    stepBlockCommand,
    stepUnblockCommand,
    stepCompleteCommand,
    stepCancelCommand,
    stepDependsCommand,
    stepInputCommand,
    stepOutputCommand,
  ]),
);
