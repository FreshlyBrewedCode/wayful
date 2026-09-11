import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../../backend/Backend";
import { liftSync } from "../../../backend/filesystem/documents";
import { attachmentOK } from "../../../domain/graph";
import { nonEmpty } from "../../../domain/identifier";
import { assertWritableMapIntegrity, fail, resolveProject, strict } from "../../../scope";
import { handle } from "../../render";
import { wayfulRoot } from "../../root";
import { assertNotTerminal, findStep, resolveStepTarget, stepArgument, stepParent } from "./shared";

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
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* backend.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        if (target.status !== "pending") yield* fail("only pending steps can be blocked.");
        const blockReason = yield* liftSync(() => nonEmpty(reason, "block reason"));
        yield* backend.saveStep(map, { ...target, status: "blocked", block_reason: blockReason });
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
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* backend.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        if (target.status !== "blocked") yield* fail("only blocked steps can be unblocked.");
        const { block_reason: _blockReason, ...rest } = target;
        yield* backend.saveStep(map, { ...rest, status: "pending" });
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
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* backend.listSteps(map));
        const target = yield* findStep(steps, token);
        yield* assertNotTerminal(target);
        const completionSummary = yield* liftSync(() => nonEmpty(summary, "completion summary"));
        if (!attachmentOK(target.required_outputs, target.outputs))
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
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveStepTarget(reference, parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const steps = yield* strict(yield* backend.listSteps(map));
        const target = yield* findStep(steps, token);
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
