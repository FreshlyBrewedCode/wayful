import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { ProjectStore } from "../../backend/ProjectStore";
import { resolveProject, strict } from "../../scope";
import { jsonFlag } from "../flags";
import { handle, printOutput } from "../render";
import { wayfulRoot } from "../root";

const typeListCommand = Command.make("list", { json: jsonFlag }, ({ json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const projectStore = yield* ProjectStore;
      const p = yield* resolveProject(root.project);
      const types = yield* strict(yield* projectStore.listTypes(p));
      yield* printOutput(json, types, types.map((t) => `${t.name}: ${t.description}`).join("\n"));
    }),
  ),
).pipe(Command.withDescription("List project types"));

const typeShowCommand = Command.make(
  "show",
  {
    name: Argument.string("name").pipe(
      Argument.withMetavar("NAME"),
      Argument.withDescription("Type name"),
    ),
    json: jsonFlag,
  },
  ({ name, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const projectStore = yield* ProjectStore;
        const p = yield* resolveProject(root.project);
        const type = yield* projectStore.getType(p, name);
        const human = `${type.name}: ${type.description}\nInstructions:\n${type.instructions || "(empty)"}`;
        yield* printOutput(json, type, human);
      }),
    ),
).pipe(Command.withDescription("Show a project type"));

export const typeCommand = Command.make("type").pipe(
  Command.withDescription("Inspect project step types"),
  Command.withSubcommands([typeListCommand, typeShowCommand]),
);
