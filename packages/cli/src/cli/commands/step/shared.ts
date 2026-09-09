import { Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { WayfulBackend, type MapHandle, type ProjectHandle } from "../../../backend/Backend";
import { liftSync } from "../../../backend/filesystem/documents";
import { MapMetadataError, WayfulError } from "../../../domain/errors";
import { slots } from "../../../domain/identifier";
import type { Slot } from "../../../domain/identifier";
import { closesStep, type StepRecord } from "../../../domain/model";
import {
  describeToken,
  expectStep,
  resolveToken,
  type ReferenceToken,
} from "../../../domain/reference";
import { fail, resolveReferencedMap } from "../../../scope";
import { mapFlag } from "../../flags";

export const stepArgument = Argument.string("step").pipe(
  Argument.withMetavar("STEP"),
  Argument.withDescription(
    "Step reference: a name, numeric id, '#id', '#name', or map-qualified ('map/name')",
  ),
);

export const stepParent = Command.make("step").pipe(
  Command.withSharedFlags({ map: mapFlag }),
  Command.withDescription("Create and manage map steps"),
);

export function resolveSlotOverride(
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

export function findStep(
  steps: readonly StepRecord[],
  token: ReferenceToken,
): Effect.Effect<StepRecord, WayfulError> {
  return Effect.gen(function* () {
    const found = resolveToken(token, steps);
    if (!found) return yield* fail(`step '${describeToken(token)}' does not exist.`);
    return found;
  });
}

/**
 * Parses a step reference and resolves the map it addresses: a map prefix on
 * the reference overrides `--map`/`WAYFUL_MAP`, since it unambiguously names
 * the map to target.
 */
export function resolveStepTarget(
  reference: string,
  contextMap: Option.Option<string>,
  project: ProjectHandle,
): Effect.Effect<
  { readonly map: MapHandle; readonly token: ReferenceToken },
  WayfulError | MapMetadataError,
  WayfulBackend
> {
  return Effect.gen(function* () {
    const ref = yield* liftSync(() => expectStep(reference));
    const map = yield* resolveReferencedMap(ref.map, contextMap, project);
    return { map, token: ref.token };
  });
}

export function assertNotTerminal(step: StepRecord): Effect.Effect<void, WayfulError> {
  return Effect.gen(function* () {
    if (closesStep(step.status)) yield* fail("terminal steps cannot be changed.");
  });
}
