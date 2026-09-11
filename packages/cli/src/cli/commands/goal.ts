import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { normalizeRef } from "../../domain/artifact-ref";
import { WayfulError } from "../../domain/errors";
import { attachmentOK } from "../../domain/graph";
import { identifier, nonEmpty, slots } from "../../domain/identifier";
import type { Slot } from "../../domain/identifier";
import { CURRENT_FORMAT_VERSION, type Attachment } from "../../domain/model";
import { assertWritableMapIntegrity, fail, resolveMap, resolveProject, strict } from "../../scope";
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
      const goals = yield* strict(yield* backend.listGoals(map));
      const human = goals
        .flatMap((g) => [`${g.name}: ${g.description}`, ...bodyLines(g.body)])
        .join("\n");
      yield* printOutput(json, goals, human);
    }),
  ),
).pipe(Command.withDescription("List goals"));

function parseRequiredOutputs(json: string): readonly Slot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new WayfulError({ message: "required-outputs must be JSON." });
  }
  const parsedSlots = slots(parsed, "--required-outputs");
  if (parsedSlots.length === 0)
    throw new WayfulError({ message: "a goal requires at least one required output slot." });
  return parsedSlots;
}

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
    requiredOutputs: Flag.string("required-outputs").pipe(
      Flag.withMetavar("JSON"),
      Flag.withDescription("Required output slots (JSON array); at least one is required"),
    ),
  },
  ({ name, description, body, requiredOutputs }) =>
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
        const requiredOutputSlots = yield* liftSync(() => parseRequiredOutputs(requiredOutputs));
        yield* backend.createGoal(map, {
          format_version: CURRENT_FORMAT_VERSION,
          name: resolvedName,
          description: resolvedDescription,
          outputs: [],
          required_outputs: requiredOutputSlots,
          body,
        });
        yield* Console.log(`Added goal '${resolvedName}'.`);
      }),
    ),
).pipe(Command.withDescription("Add a goal"));

const goalOutputCommand = Command.make(
  "output",
  {
    goal: Flag.string("goal").pipe(Flag.withMetavar("NAME"), Flag.withDescription("Goal name")),
    ref: Argument.string("ref").pipe(
      Argument.withMetavar("REF"),
      Argument.withDescription("Artifact reference, e.g. 'file:docs/spec.md' or 'https://...'"),
    ),
    slot: Flag.string("slot").pipe(
      Flag.withMetavar("NAME"),
      Flag.withDescription("Fulfill a required output slot"),
      Flag.optional,
    ),
    kind: Flag.string("kind").pipe(
      Flag.withMetavar("KIND"),
      Flag.withDescription("Kind of a supplementary (non-slot) attachment"),
      Flag.optional,
    ),
  },
  ({ goal, ref: rawRef, slot, kind }) =>
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
        const goals = yield* strict(yield* backend.listGoals(map));
        const target = goals.find((g) => g.name === resolvedGoalName);
        if (!target) return yield* fail(`goal '${resolvedGoalName}' does not exist.`);
        const normalizedRef = yield* liftSync(() => normalizeRef(rawRef));
        let attachment: Attachment;
        if (Option.isSome(slot)) {
          if (Option.isSome(kind)) return yield* fail("--slot and --kind are mutually exclusive.");
          const slotName = yield* liftSync(() => identifier(slot.value, "slot name"));
          const slotDefinition = target.required_outputs.find(
            (candidate) => candidate.name === slotName,
          );
          if (!slotDefinition)
            return yield* fail(`slot '${slotName}' is not a required output slot.`);
          if (
            target.outputs.some(
              (existing) =>
                existing !== null &&
                typeof existing === "object" &&
                (existing as { slot?: unknown }).slot === slotName,
            )
          )
            return yield* fail(`slot '${slotName}' is already fulfilled.`);
          attachment = { slot: slotName, ref: normalizedRef };
        } else {
          if (Option.isNone(kind))
            return yield* fail(
              "supplementary attachments require --kind (or pass --slot to fulfill a required output slot).",
            );
          const resolvedKind = yield* liftSync(() => nonEmpty(kind.value, "attachment kind"));
          attachment = { ref: normalizedRef, kind: resolvedKind };
        }
        yield* backend.saveGoal(map, { ...target, outputs: [...target.outputs, attachment] });
        yield* Console.log(`Attached '${normalizedRef}'.`);
      }),
    ),
).pipe(Command.withDescription("Attach a ref as a goal output"));

const goalSatisfyCommand = Command.make(
  "satisfy",
  {
    goal: Flag.string("goal").pipe(Flag.withMetavar("NAME"), Flag.withDescription("Goal name")),
  },
  ({ goal }) =>
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
        const goals = yield* strict(yield* backend.listGoals(map));
        const target = goals.find((g) => g.name === resolvedGoalName);
        if (!target) return yield* fail(`goal '${resolvedGoalName}' does not exist.`);
        if (!attachmentOK(target.required_outputs, target.outputs))
          return yield* fail("required output slots are not fulfilled.");
        yield* backend.saveGoal(map, target);
        yield* Console.log(`Satisfied goal '${resolvedGoalName}'.`);
      }),
    ),
).pipe(Command.withDescription("Satisfy a goal once its required output slots are filled"));

export const goalCommand = goalParent.pipe(
  Command.withSubcommands([goalListCommand, goalAddCommand, goalOutputCommand, goalSatisfyCommand]),
);
