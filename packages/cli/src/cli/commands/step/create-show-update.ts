import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { MapStore } from "../../../backend/MapStore";
import { ProjectStore } from "../../../backend/ProjectStore";
import { liftSync } from "../../../backend/filesystem/documents";
import { identifier, nonEmpty } from "../../../domain/identifier";
import { CURRENT_FORMAT_VERSION, type NewStepRecord } from "../../../domain/model";
import {
  assertWritableMapIntegrity,
  fail,
  resolveMap,
  resolveProject,
  strict,
} from "../../../scope";
import { jsonFlag } from "../../flags";
import { handle, printOutput } from "../../render";
import { wayfulRoot } from "../../root";
import {
  assertNotTerminal,
  findStep,
  resolveSlotOverride,
  resolveStepTarget,
  stepArgument,
  stepParent,
} from "./shared";

export const stepCreateCommand = Command.make(
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
        const mapStore = yield* MapStore;
        const projectStore = yield* ProjectStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const stepName = yield* liftSync(() => identifier(name, "step name", true));
        if (steps.some((s) => s.name === stepName))
          yield* fail(`step '${stepName}' already exists.`);
        const typeName = yield* liftSync(() => identifier(type, "step type"));
        const typeDefinition = yield* projectStore.getType(project, typeName);
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
        const step: NewStepRecord = {
          format_version: CURRENT_FORMAT_VERSION,
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
        const created = yield* mapStore.createStep(map, step);
        yield* Console.log(`Created step ${created.id} '${stepName}'.`);
      }),
    ),
).pipe(Command.withDescription("Create a step"));

export const stepShowCommand = Command.make(
  "show",
  { step: stepArgument, json: jsonFlag },
  ({ step: reference, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const parent = yield* stepParent;
        const mapStore = yield* MapStore;
        const projectStore = yield* ProjectStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        const instructions = yield* projectStore.getType(project, target.type).pipe(
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

export const stepUpdateCommand = Command.make(
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
        const mapStore = yield* MapStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        if (target.status !== "pending") yield* fail("only pending steps can be updated.");
        if (Option.isNone(description) && Option.isNone(body))
          yield* fail("step update requires --description or --body.");
        const nextDescription = Option.isSome(description)
          ? yield* liftSync(() => nonEmpty(description.value, "step description"))
          : target.description;
        const nextBody = Option.getOrElse(body, () => target.body);
        yield* mapStore.saveStep(map, { ...target, description: nextDescription, body: nextBody });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Update a pending step's description or body"));
