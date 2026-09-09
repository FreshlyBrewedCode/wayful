#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { CliError, Command } from "effect/unstable/cli";

import { FileSystemBackend } from "./backend/filesystem/layer";
import { cli } from "./cli/cli";

// Injected by `bun build --define 'WAYFUL_BUILD_VERSION:"x.y.z"'` in a release
// build; `typeof` never throws on an identifier `--define` didn't replace, so
// this still runs under plain `bun run` during development.
declare const WAYFUL_BUILD_VERSION: string | undefined;
const VERSION = typeof WAYFUL_BUILD_VERSION === "string" ? WAYFUL_BUILD_VERSION : "0.0.0-dev";

const AppLayer = Layer.merge(
  FileSystemBackend.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

// Indexed rather than dotted access so the repo's no-underscore-dangle rule
// stays satisfied; TypeScript still narrows the union on a literal key.
const isShowHelp = (error: CliError.CliError): error is CliError.ShowHelp =>
  error["_tag"] === "ShowHelp";

/**
 * The concise `wayful:`-prefixed stderr lines a failed invocation reports.
 *
 * The framework funnels bare `wayful`, every parse mistake, and an explicit
 * `--help` alike through `ShowHelp`, whose own `message` is the constant
 * "Help requested" — useless on its own. The diagnosis a caller actually
 * needs (which flag is missing, which subcommand was misspelled and what they
 * probably meant) lives in `errors`, which is empty only for a deliberate
 * help request. So report every collected error rather than the wrapper, and
 * point at the help for the exact command path that failed.
 */
function usageLines(error: CliError.CliError): readonly string[] {
  if (!isShowHelp(error)) return [error.message];
  return [
    ...error.errors.map((collected) => collected.message),
    `See '${error.commandPath.join(" ")} --help'.`,
  ];
}

const program = Command.run(cli, { version: VERSION, renderErrors: false }).pipe(
  // A `ShowHelp` carrying no errors is a deliberate `--help`/bare invocation:
  // the framework has already printed the help text, and that is a success.
  // Everything else — a mistake-triggered `ShowHelp` included — is this CLI's
  // usage/operational failure, always exit 2 (1 stays reserved for an invalid
  // map from `map validate`).
  Effect.catch((error) =>
    Effect.gen(function* () {
      if (isShowHelp(error) && error.errors.length === 0) {
        process.exitCode = 0;
        return;
      }
      for (const line of usageLines(error)) yield* Console.error(`wayful: ${line}`);
      process.exitCode = 2;
    }),
  ),
  Effect.provide(AppLayer),
);

BunRuntime.runMain(program);
