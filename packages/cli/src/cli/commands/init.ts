import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { nonEmpty } from "../../domain/identifier";
import { handle } from "../render";
import { wayfulRoot } from "../root";

export const initCommand = Command.make(
  "init",
  {
    description: Flag.string("description").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Optional project description"),
      Flag.optional,
    ),
  },
  ({ description }) =>
    handle(
      false,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const backend = yield* WayfulBackend;
        const directory = Option.getOrElse(root.project, () => process.cwd());
        const resolvedDescription = yield* Option.match(description, {
          onNone: () => Effect.succeed(""),
          onSome: (value) => liftSync(() => nonEmpty(value, "project description")),
        });
        yield* backend.initProject({ directory, description: resolvedDescription });
        yield* Console.log("Initialized Wayful project.");
      }),
    ),
).pipe(Command.withDescription("Initialize a Wayful project"));
