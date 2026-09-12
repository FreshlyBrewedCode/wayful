import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { MapStore } from "@backend/MapStore";
import { liftSync } from "@backend/filesystem/documents";
import { attachmentOK } from "@domain/graph";
import { nonEmpty } from "@domain/identifier";
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

export const stepBlockCommand = Command.make(
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
        const mapStore = yield* MapStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        if (target.status !== "pending") return yield* fail("only pending steps can be blocked.");
        const blockReason = yield* liftSync(() => nonEmpty(reason, "block reason"));
        yield* mapStore.saveStep(map, { ...target, status: "blocked", block_reason: blockReason });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Block a pending step"));

export const stepUnblockCommand = Command.make(
  "unblock",
  { step: stepArgument },
  ({ step: reference }) =>
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
        if (target.status !== "blocked") return yield* fail("only blocked steps can be unblocked.");
        const { block_reason: _blockReason, ...rest } = target;
        yield* mapStore.saveStep(map, { ...rest, status: "pending" });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Unblock a blocked step"));

export const stepCompleteCommand = Command.make(
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
        const mapStore = yield* MapStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        const completionSummary = yield* liftSync(() => nonEmpty(summary, "completion summary"));
        if (!attachmentOK(target.required_outputs, target.outputs))
          return yield* fail("required output slots are not fulfilled.");
        yield* mapStore.saveStep(map, {
          ...target,
          status: "complete",
          completion_summary: completionSummary,
        });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Complete a step"));

export const stepCancelCommand = Command.make(
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
        const mapStore = yield* MapStore;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* mapStore.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        const cancellationReason = yield* liftSync(() => nonEmpty(reason, "cancellation reason"));
        yield* mapStore.saveStep(map, {
          ...target,
          status: "cancelled",
          cancellation_reason: cancellationReason,
        });
        yield* Console.log(`Updated step '${target.name}'.`);
      }),
    ),
).pipe(Command.withDescription("Cancel a pending or blocked step"));
