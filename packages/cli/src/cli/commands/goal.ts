import { Console, Effect } from "effect";
import { Command, Flag, Param } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { identifier, nonEmpty } from "../../domain/identifier";
import { assertWritableMapIntegrity, fail, resolveMap, resolveProject } from "../../scope";
import { jsonFlag, mapFlag } from "../flags";
import { bodyLines, handle, printOutput } from "../render";
import { wayfulRoot } from "../root";

const goalParent = Command.make("goal").pipe(
  Command.withSharedFlags({ map: mapFlag }),
  Command.withDescription("Manage map goals"),
);

const goalListCommand = Command.make("list", { json: jsonFlag }, ({ json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const parent = yield* goalParent;
      const backend = yield* WayfulBackend;
      const root = yield* wayfulRoot;
      const project = yield* resolveProject(root.project);
      const map = yield* resolveMap(parent.map, project);
      const goals = yield* backend.listGoals(map);
      const human = goals
        .flatMap((g) => [`${g.name}: ${g.description}`, ...bodyLines(g.body)])
        .join("\n");
      yield* printOutput(json, goals, human);
    }),
  ),
).pipe(Command.withDescription("List goals"));

const goalAddCommand = Command.make(
  "add",
  {
    name: Flag.string("name").pipe(Flag.withMetavar("NAME"), Flag.withDescription("Goal name")),
    description: Flag.string("description").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Goal description"),
    ),
    body: Flag.string("body").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Optional goal Markdown body"),
      Flag.withDefault(""),
    ),
  },
  ({ name, description, body }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* goalParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const resolvedName = yield* liftSync(() => identifier(name, "goal name"));
        const resolvedDescription = yield* liftSync(() =>
          nonEmpty(description, "goal description"),
        );
        yield* backend.createGoal(map, {
          format_version: 1,
          name: resolvedName,
          description: resolvedDescription,
          evidence: [],
          body,
        });
        yield* Console.log(`Added goal '${resolvedName}'.`);
      }),
    ),
).pipe(Command.withDescription("Add a goal"));

const goalSatisfyCommand = Command.make(
  "satisfy",
  {
    goal: Flag.string("goal").pipe(Flag.withMetavar("NAME"), Flag.withDescription("Goal name")),
    artifact: Param.variadic(
      Flag.string("artifact").pipe(
        Flag.withMetavar("NAME"),
        Flag.withDescription("Evidence artifact (repeat for additional evidence)"),
      ),
    ),
    evidence: Param.variadic(
      Flag.string("evidence").pipe(
        Flag.withMetavar("NAME"),
        Flag.withDescription("Alias for --artifact"),
      ),
    ),
  },
  ({ goal, artifact, evidence }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* goalParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const resolvedGoalName = yield* liftSync(() => identifier(goal, "goal name"));
        const goals = yield* backend.listGoals(map);
        const target = goals.find((g) => g.name === resolvedGoalName);
        if (!target) return yield* fail(`goal '${resolvedGoalName}' does not exist.`);
        if (target.evidence.length)
          return yield* fail(`goal '${resolvedGoalName}' is already satisfied.`);
        const combinedEvidence = [...artifact, ...evidence];
        if (!combinedEvidence.length) yield* fail("at least one evidence artifact is required.");
        const artifacts = yield* backend.listArtifacts(map);
        for (const evidenceName of combinedEvidence) {
          yield* liftSync(() => identifier(evidenceName, "artifact name"));
          if (!artifacts.some((a) => a.name === evidenceName))
            yield* fail(`artifact '${evidenceName}' does not exist.`);
        }
        yield* backend.saveGoal(map, { ...target, evidence: combinedEvidence });
        yield* Console.log(`Satisfied goal '${resolvedGoalName}'.`);
      }),
    ),
).pipe(Command.withDescription("Satisfy a goal with evidence"));

export const goalCommand = goalParent.pipe(
  Command.withSubcommands([goalListCommand, goalAddCommand, goalSatisfyCommand]),
);
