import { Command } from "effect/unstable/cli";

import { stepCreateCommand, stepShowCommand, stepUpdateCommand } from "./create-show-update";
import {
  stepBlockCommand,
  stepCancelCommand,
  stepCompleteCommand,
  stepUnblockCommand,
} from "./lifecycle";
import { stepDependsCommand, stepInputCommand, stepOutputCommand } from "./relations";
import { stepParent } from "./shared";

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
