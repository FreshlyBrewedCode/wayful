#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { FileSystemBackend } from "./backend/filesystem/layer";
import { cli } from "./cli/cli";

const VERSION = "0.1.0";

const AppLayer = Layer.merge(
  FileSystemBackend.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const program = Command.run(cli, { version: VERSION, renderErrors: false }).pipe(
  // The framework always renders help text itself (bare `wayful`, a parse
  // mistake, or an explicit `--help` all funnel through `ShowHelp`), tagging
  // the error with exit code 0 only for a deliberate `--help`/bare
  // invocation. Everything else — a mistake-triggered `ShowHelp` included —
  // is this CLI's usage/operational failure, always exit 2.
  Effect.catch((error) => {
    const isDeliberateHelp = error["_tag"] === "ShowHelp" && Runtime.getErrorExitCode(error) === 0;
    return Effect.gen(function* () {
      if (!isDeliberateHelp) yield* Console.error(`wayful: ${error.message}`);
      process.exitCode = isDeliberateHelp ? 0 : 2;
    });
  }),
  Effect.provide(AppLayer),
);

BunRuntime.runMain(program);
