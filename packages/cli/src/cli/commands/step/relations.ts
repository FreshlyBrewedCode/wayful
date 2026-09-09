import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../../backend/Backend";
import { liftSync } from "../../../backend/filesystem/documents";
import { reaches } from "../../../domain/graph";
import { identifier } from "../../../domain/identifier";
import {
  assertSameMap,
  describeToken,
  expectArtifact,
  expectStep,
  resolveToken,
} from "../../../domain/reference";
import { assertWritableMapIntegrity, fail, resolveProject, strict } from "../../../scope";
import { handle } from "../../render";
import { wayfulRoot } from "../../root";
import { assertNotTerminal, findStep, resolveStepTarget, stepArgument, stepParent } from "./shared";

export const stepDependsCommand = Command.make(
  "depends",
  {
    step: stepArgument,
    on: Flag.string("on").pipe(
      Flag.withMetavar("STEP"),
      Flag.withDescription(
        "Prerequisite step reference (name, '#id', or '#name'); cannot cross maps",
      ),
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
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* backend.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        const onRef = yield* liftSync(() => expectStep(on));
        yield* liftSync(() => assertSameMap(onRef.map, map.metadata.name, "a dependency"));
        const prerequisite = yield* findStep(steps, onRef.token);
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
        Flag.withMetavar("ARTIFACT"),
        Flag.withDescription(
          "Existing artifact reference (name, '@id', or '@name'); cannot cross maps",
        ),
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
          const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
          yield* assertWritableMapIntegrity(map);
          const steps = yield* strict(yield* backend.listSteps(map));
          const target = yield* findStep(steps, token);
          yield* assertNotTerminal(target);
          const artifactRef = yield* liftSync(() => expectArtifact(artifactName));
          yield* liftSync(() => assertSameMap(artifactRef.map, map.metadata.name, "an artifact"));
          const artifacts = yield* strict(yield* backend.listArtifacts(map));
          const artifact = resolveToken(artifactRef.token, artifacts);
          if (!artifact)
            return yield* fail(`artifact '${describeToken(artifactRef.token)}' does not exist.`);
          const resolvedArtifactName = artifact.name;
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

export const stepInputCommand = makeAttachCommand("input", "inputs");
export const stepOutputCommand = makeAttachCommand("output", "outputs");
