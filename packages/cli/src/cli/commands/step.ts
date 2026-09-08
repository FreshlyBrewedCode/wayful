import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { WayfulError } from "../../domain/errors";
import { attachmentOK, reaches } from "../../domain/graph";
import { identifier, nonEmpty, slots } from "../../domain/identifier";
import type { Slot } from "../../domain/identifier";
import type { StepRecord } from "../../domain/model";
import { assertWritableMapIntegrity, fail, resolveMap, resolveProject } from "../../scope";
import { jsonFlag, mapFlag } from "../flags";
import { handle, printOutput } from "../render";
import { wayfulRoot } from "../root";

const stepArgument = Argument.string("step").pipe(
  Argument.withMetavar("STEP"),
  Argument.withDescription("Step name or numeric ID"),
);

const stepParent = Command.make("step").pipe(
  Command.withSharedFlags({ map: mapFlag }),
  Command.withDescription("Create and manage map steps"),
);

function resolveSlotOverride(
  flag: Option.Option<string>,
  flagName: string,
  inherited: readonly Slot[],
): Effect.Effect<readonly Slot[], WayfulError> {
  return Option.match(flag, {
    onNone: () => Effect.succeed(inherited),
    onSome: (json) =>
      liftSync(() => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          throw new WayfulError({ message: "required slot override must be JSON." });
        }
        return slots(parsed, `--${flagName}`);
      }),
  });
}

function findStep(
  steps: readonly StepRecord[],
  reference: string,
): Effect.Effect<StepRecord, WayfulError> {
  return Effect.gen(function* () {
    const found = /^\d+$/.test(reference)
      ? steps.find((s) => s.id === Number(reference))
      : steps.find((s) => s.name === reference);
    if (!found) return yield* fail(`step '${reference}' does not exist.`);
    return found;
  });
}

function assertNotTerminal(step: StepRecord): Effect.Effect<void, WayfulError> {
  return Effect.gen(function* () {
    if (step.status === "complete" || step.status === "cancelled")
      yield* fail("terminal steps cannot be changed.");
  });
}

const stepCreateCommand = Command.make(
  "create",
  {
    name: Argument.string("name").pipe(
      Argument.withMetavar("NAME"),
      Argument.withDescription("Step name"),
    ),
    type: Flag.string("type").pipe(Flag.withMetavar("TYPE"), Flag.withDescription("Step type")),
    description: Flag.string("description").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Result description"),
    ),
    body: Flag.string("body").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Optional Markdown body"),
      Flag.withDefault(""),
    ),
    requiredInputs: Flag.string("required-inputs").pipe(
      Flag.withMetavar("JSON"),
      Flag.withDescription("Replace inherited required input slots"),
      Flag.optional,
    ),
    requiredOutputs: Flag.string("required-outputs").pipe(
      Flag.withMetavar("JSON"),
      Flag.withDescription("Replace inherited required output slots"),
      Flag.optional,
    ),
  },
  ({ name, type, description, body, requiredInputs, requiredOutputs }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const stepName = yield* liftSync(() => identifier(name, "step name", true));
        if (steps.some((s) => s.name === stepName))
          yield* fail(`step '${stepName}' already exists.`);
        const highestStepID = steps.reduce((highest, s) => Math.max(highest, s.id), 0);
        const id = map.metadata.step_id_counter;
        if (id <= highestStepID)
          yield* fail("map step_id_counter must be greater than every existing step ID.");
        const typeName = yield* liftSync(() => identifier(type, "step type"));
        const typeDefinition = yield* backend.getType(project, typeName);
        if (map.metadata.allowed_step_types && !map.metadata.allowed_step_types.includes(typeName))
          yield* fail(`type '${typeName}' is not allowed by this map.`);
        const requiredInputSlots = yield* resolveSlotOverride(
          requiredInputs,
          "required-inputs",
          typeDefinition.required_inputs,
        );
        const requiredOutputSlots = yield* resolveSlotOverride(
          requiredOutputs,
          "required-outputs",
          typeDefinition.required_outputs,
        );
        const resolvedDescription = yield* liftSync(() =>
          nonEmpty(description, "step description"),
        );
        const step: StepRecord = {
          format_version: 1,
          id,
          name: stepName,
          type: typeName,
          description: resolvedDescription,
          status: "pending",
          dependencies: [],
          inputs: [],
          outputs: [],
          required_inputs: requiredInputSlots,
          required_outputs: requiredOutputSlots,
          body,
        };
        yield* backend.createStep(map, step);
        yield* backend.setStepIdCounter(map, id + 1);
        yield* Console.log(`Created step ${id} '${stepName}'.`);
      }),
    ),
).pipe(Command.withDescription("Create a step"));

const stepShowCommand = Command.make(
  "show",
  { step: stepArgument, json: jsonFlag },
  ({ step: reference, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        const instructions = yield* backend.getType(project, target.type).pipe(
          Effect.map((type) => type.instructions),
          Effect.catch(() =>
            Effect.succeed("unavailable: referenced type is missing or malformed."),
          ),
        );
        const human = [
          `${target.id} ${target.name}`,
          target.description,
          "Body:",
          target.body || "(empty)",
          "Type instructions:",
          instructions || "(empty)",
        ].join("\n");
        yield* printOutput(json, { ...target, instructions }, human);
      }),
    ),
).pipe(Command.withDescription("Show a step"));

const stepUpdateCommand = Command.make(
  "update",
  {
    step: stepArgument,
    description: Flag.string("description").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("New step description"),
      Flag.optional,
    ),
    body: Flag.string("body").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Replace the Markdown body"),
      Flag.optional,
    ),
  },
  ({ step: reference, description, body }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        yield* assertNotTerminal(target);
        if (target.status !== "pending") yield* fail("only pending steps can be updated.");
        if (Option.isNone(description) && Option.isNone(body))
          yield* fail("step update requires --description or --body.");
        const nextDescription = Option.isSome(description)
          ? yield* liftSync(() => nonEmpty(description.value, "step description"))
          : target.description;
        const nextBody = Option.getOrElse(body, () => target.body);
        yield* backend.saveStep(map, { ...target, description: nextDescription, body: nextBody });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Update a pending step's description or body"));

const stepBlockCommand = Command.make(
  "block",
  {
    step: stepArgument,
    reason: Flag.string("reason").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Block reason"),
    ),
  },
  ({ step: reference, reason }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        yield* assertNotTerminal(target);
        if (target.status !== "pending") yield* fail("only pending steps can be blocked.");
        const blockReason = yield* liftSync(() => nonEmpty(reason, "block reason"));
        yield* backend.saveStep(map, { ...target, status: "blocked", block_reason: blockReason });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Block a pending step"));

const stepUnblockCommand = Command.make("unblock", { step: stepArgument }, ({ step: reference }) =>
  handle(
    false,
    Effect.gen(function* () {
      const parent = yield* stepParent;
      const backend = yield* WayfulBackend;
      const root = yield* wayfulRoot;
      const project = yield* resolveProject(root.project);
      const map = yield* resolveMap(parent.map, project);
      yield* assertWritableMapIntegrity(map);
      const steps = yield* backend.listSteps(map);
      const target = yield* findStep(steps, reference);
      yield* assertNotTerminal(target);
      if (target.status !== "blocked") yield* fail("only blocked steps can be unblocked.");
      const { block_reason: _blockReason, ...rest } = target;
      yield* backend.saveStep(map, { ...rest, status: "pending" });
      yield* Console.log(`Updated step '${target.name}'.`);
    }),
  ),
).pipe(Command.withDescription("Unblock a blocked step"));

const stepCompleteCommand = Command.make(
  "complete",
  {
    step: stepArgument,
    summary: Flag.string("summary").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Completion summary"),
    ),
  },
  ({ step: reference, summary }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        yield* assertNotTerminal(target);
        const completionSummary = yield* liftSync(() => nonEmpty(summary, "completion summary"));
        const artifacts = yield* backend.listArtifacts(map);
        if (!attachmentOK(target, "outputs", artifacts))
          yield* fail("required output slots are not fulfilled.");
        yield* backend.saveStep(map, {
          ...target,
          status: "complete",
          completion_summary: completionSummary,
        });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Complete a step"));

const stepCancelCommand = Command.make(
  "cancel",
  {
    step: stepArgument,
    reason: Flag.string("reason").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Cancellation reason"),
    ),
  },
  ({ step: reference, reason }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        yield* assertNotTerminal(target);
        const cancellationReason = yield* liftSync(() => nonEmpty(reason, "cancellation reason"));
        yield* backend.saveStep(map, {
          ...target,
          status: "cancelled",
          cancellation_reason: cancellationReason,
        });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Cancel a pending or blocked step"));

const stepDependsCommand = Command.make(
  "depends",
  {
    step: stepArgument,
    on: Flag.string("on").pipe(
      Flag.withMetavar("STEP"),
      Flag.withDescription("Prerequisite step name or numeric ID"),
    ),
  },
  ({ step: reference, on }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* backend.listSteps(map);
        const target = yield* findStep(steps, reference);
        yield* assertNotTerminal(target);
        const prerequisite = yield* findStep(steps, on);
        if (target.id === prerequisite.id) yield* fail("a step cannot depend on itself.");
        if (target.dependencies.includes(prerequisite.id)) yield* fail("duplicate dependency.");
        if (prerequisite.status === "cancelled") yield* fail("cannot depend on a cancelled step.");
        if (reaches(steps, prerequisite.id, target.id))
          yield* fail("dependency would create a cycle.");
        yield* backend.saveStep(map, {
          ...target,
          dependencies: [...target.dependencies, prerequisite.id],
        });
        yield* Console.log(`Added dependency to '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Add a dependency to a step"));

function makeAttachCommand(name: "input" | "output", direction: "inputs" | "outputs") {
  return Command.make(
    name,
    {
      step: stepArgument,
      artifact: Flag.string("artifact").pipe(
        Flag.withMetavar("NAME"),
        Flag.withDescription("Existing artifact name"),
      ),
      slot: Flag.string("slot").pipe(
        Flag.withMetavar("NAME"),
        Flag.withDescription("Fulfill a required slot"),
        Flag.optional,
      ),
    },
    ({ step: reference, artifact: artifactName, slot }) =>
      handle(
        false,
        Effect.gen(function* () {
          const parent = yield* stepParent;
          const backend = yield* WayfulBackend;
          const root = yield* wayfulRoot;
          const project = yield* resolveProject(root.project);
          const map = yield* resolveMap(parent.map, project);
          yield* assertWritableMapIntegrity(map);
          const steps = yield* backend.listSteps(map);
          const target = yield* findStep(steps, reference);
          yield* assertNotTerminal(target);
          const resolvedArtifactName = yield* liftSync(() =>
            identifier(artifactName, "artifact name"),
          );
          const artifacts = yield* backend.listArtifacts(map);
          const artifact = artifacts.find((candidate) => candidate.name === resolvedArtifactName);
          if (!artifact) return yield* fail(`artifact '${resolvedArtifactName}' does not exist.`);
          let attachment: { readonly artifact: string; readonly slot?: string } = {
            artifact: resolvedArtifactName,
          };
          if (Option.isSome(slot)) {
            const slotName = yield* liftSync(() => identifier(slot.value, "slot name"));
            const required =
              direction === "inputs" ? target.required_inputs : target.required_outputs;
            const slotDefinition = required.find((candidate) => candidate.name === slotName);
            if (!slotDefinition)
              return yield* fail(`slot '${slotName}' is not a required ${name} slot.`);
            if (slotDefinition.kind !== artifact.kind)
              return yield* fail(`artifact kind does not match slot '${slotName}'.`);
            if (
              target[direction].some(
                (existing) =>
                  existing !== null &&
                  typeof existing === "object" &&
                  (existing as { slot?: unknown }).slot === slotName,
              )
            )
              return yield* fail(`slot '${slotName}' is already fulfilled.`);
            attachment = { artifact: resolvedArtifactName, slot: slotName };
          }
          yield* backend.saveStep(map, {
            ...target,
            [direction]: [...target[direction], attachment],
          });
          yield* Console.log(`Attached artifact '${resolvedArtifactName}'.`);
        }),
      ),
  ).pipe(Command.withDescription(`Attach an artifact as a step ${name}`));
}

const stepInputCommand = makeAttachCommand("input", "inputs");
const stepOutputCommand = makeAttachCommand("output", "outputs");

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
