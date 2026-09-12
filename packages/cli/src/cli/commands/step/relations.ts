import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { MapStore } from "@backend/MapStore";
import { liftSync } from "@backend/filesystem/documents";
import { normalizeRef } from "@domain/artifact-ref";
import { reaches } from "@domain/graph";
import { identifier, nonEmpty } from "@domain/identifier";
import type { Attachment } from "@domain/model";
import { assertSameMap, expectStep } from "@domain/reference";
import { assertWritableMapIntegrity, fail, resolveProject, strict } from "@/scope";
import { handle } from "@cli/render";
import { wayfulRoot } from "@cli/root";
import {
  assertNotTerminal,
  findStep,
  resolveStepTarget,
  stepArgument,
  stepParent,
} from "@cli/commands/step/shared";

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
        const mapStore = yield* MapStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        const onRef = yield* liftSync(() => expectStep(on));
        yield* liftSync(() => assertSameMap(onRef.map, map.metadata.name, "a dependency"));
        const prerequisite = yield* findStep(steps, onRef.token);
        if (target.id === prerequisite.id) return yield* fail("a step cannot depend on itself.");
        if (target.dependencies.includes(prerequisite.id))
          return yield* fail("duplicate dependency.");
        if (prerequisite.status === "cancelled")
          return yield* fail("cannot depend on a cancelled step.");
        if (reaches(steps, prerequisite.id, target.id))
          return yield* fail("dependency would create a cycle.");
        yield* mapStore.saveStep(map, {
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
      ref: Argument.string("ref").pipe(
        Argument.withMetavar("REF"),
        Argument.withDescription("Artifact reference, e.g. 'file:docs/spec.md' or 'https://...'"),
      ),
      slot: Flag.string("slot").pipe(
        Flag.withMetavar("NAME"),
        Flag.withDescription("Fulfill a required slot"),
        Flag.optional,
      ),
      kind: Flag.string("kind").pipe(
        Flag.withMetavar("KIND"),
        Flag.withDescription("Kind of a supplementary (non-slot) attachment"),
        Flag.optional,
      ),
    },
    ({ step: reference, ref: rawRef, slot, kind }) =>
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
          const normalizedRef = yield* liftSync(() => normalizeRef(rawRef));
          let attachment: Attachment;
          if (Option.isSome(slot)) {
            if (Option.isSome(kind))
              return yield* fail("--slot and --kind are mutually exclusive.");
            const slotName = yield* liftSync(() => identifier(slot.value, "slot name"));
            const required =
              direction === "inputs" ? target.required_inputs : target.required_outputs;
            const slotDefinition = required.find((candidate) => candidate.name === slotName);
            if (!slotDefinition)
              return yield* fail(`slot '${slotName}' is not a required ${name} slot.`);
            if (
              target[direction].some(
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
                `supplementary attachments require --kind (or pass --slot to fulfill a required ${name} slot).`,
              );
            const resolvedKind = yield* liftSync(() => nonEmpty(kind.value, "attachment kind"));
            attachment = { ref: normalizedRef, kind: resolvedKind };
          }
          yield* mapStore.saveStep(map, {
            ...target,
            [direction]: [...target[direction], attachment],
          });
          yield* Console.log(`Attached '${normalizedRef}'.`);
        }),
      ),
  ).pipe(Command.withDescription(`Attach a ref as a step ${name}`));
}

export const stepInputCommand = makeAttachCommand("input", "inputs");
export const stepOutputCommand = makeAttachCommand("output", "outputs");
