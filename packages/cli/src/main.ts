#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { CliError, CliOutput, Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";

import { Backend } from "@backend/backend";
import { GithubCredentialsLayer } from "@backend/github/credentials";
import { GithubHttpLayer } from "@backend/github/http";
import { cli } from "@cli/cli";
import { helpCapturingFormatter, takeHelpText } from "@cli/help-output";
import { report } from "@cli/report";

// Injected by `bun build --define 'WAYFUL_BUILD_VERSION:"x.y.z"'` in a release
// build; `typeof` never throws on an identifier `--define` didn't replace, so
// this still runs under plain `bun run` during development.
declare const WAYFUL_BUILD_VERSION: string | undefined;
const VERSION = typeof WAYFUL_BUILD_VERSION === "string" ? WAYFUL_BUILD_VERSION : "0.0.0-dev";

const InfraLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  GithubHttpLayer.pipe(Layer.provide(FetchHttpClient.layer)),
  GithubCredentialsLayer.pipe(Layer.provide(BunServices.layer)),
);

const AppLayer = Layer.mergeAll(
  Backend.pipe(Layer.provideMerge(InfraLayer)),
  CliOutput.layer(helpCapturingFormatter),
);

// Indexed rather than dotted access so the repo's no-underscore-dangle rule
// stays satisfied; TypeScript still narrows the union on a literal key.
const isShowHelp = (error: CliError.CliError): error is CliError.ShowHelp =>
  error["_tag"] === "ShowHelp";

/**
 * The diagnosis a failed invocation reports.
 *
 * The framework funnels bare `wayful`, every parse mistake, and an explicit
 * `--help` alike through `ShowHelp`, whose own `message` is the constant
 * "Help requested" — useless on its own. The diagnosis a caller actually
 * needs (which flag is missing, which subcommand was misspelled and what they
 * probably meant) lives in `errors`, which is empty only for a deliberate
 * help request.
 */
function usageMessage(error: CliError.CliError): string {
  if (!isShowHelp(error)) return error.message;
  return error.errors.length
    ? error.errors.map((collected) => collected.message).join(" ")
    : error.message;
}

// The flag hasn't been parsed yet at this stage — a parse-stage failure is
// exactly what prevented that — so this is a heuristic scan of the raw argv
// rather than a real flag read.
const requestedJson = process.argv
  .slice(2)
  .some((argument) => argument === "--json" || argument.startsWith("--json="));

const program = Command.run(cli, { version: VERSION, renderErrors: false }).pipe(
  // A deliberate `--help`/`--version`/bare invocation succeeds the program;
  // print back whatever `helpCapturingFormatter` intercepted from the
  // framework's own render so it still reaches stdout.
  Effect.tap(() =>
    Effect.gen(function* () {
      const text = takeHelpText();
      if (text) yield* Console.log(text);
    }),
  ),
  // A `ShowHelp` carrying no errors is a deliberate `--help`/bare invocation:
  // the framework has already rendered the help text (captured above), and
  // that is a success. Everything else — a mistake-triggered `ShowHelp`
  // included — is this CLI's usage/operational failure: report it through
  // the same contract `handle()` uses for domain/backend failures, and
  // discard the captured help text so a mistake never dumps it to stdout,
  // always exit 2 (1 stays reserved for an invalid map from `map validate`).
  Effect.catch((error) =>
    Effect.gen(function* () {
      if (isShowHelp(error) && error.errors.length === 0) {
        const text = takeHelpText();
        if (text) yield* Console.log(text);
        process.exitCode = 0;
        return;
      }
      takeHelpText();
      yield* report({
        json: requestedJson,
        message: usageMessage(error),
        usageHint: isShowHelp(error) ? `See '${error.commandPath.join(" ")} --help'.` : undefined,
      });
    }),
  ),
  Effect.provide(AppLayer),
);

BunRuntime.runMain(program);
