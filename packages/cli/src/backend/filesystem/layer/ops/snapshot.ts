import { Effect } from "effect";

import type { WayfulError } from "@domain/errors";
import { deriveArtifacts } from "@domain/graph";
import type { CollectionRead, GoalRecord, StepRecord, TypeDefinition } from "@domain/model";
import type { MapHandle } from "@backend/MapStore";
import type { ProjectHandle } from "@backend/ProjectStore";

export function makeSnapshotOp(deps: {
  readonly listSteps: (map: MapHandle) => Effect.Effect<CollectionRead<StepRecord>, WayfulError>;
  readonly listGoals: (map: MapHandle) => Effect.Effect<CollectionRead<GoalRecord>, WayfulError>;
  readonly listTypes: (
    project: ProjectHandle,
  ) => Effect.Effect<CollectionRead<TypeDefinition>, WayfulError>;
}) {
  return {
    snapshot: (map: MapHandle) =>
      Effect.gen(function* () {
        const steps = yield* deps.listSteps(map);
        const goals = yield* deps.listGoals(map);
        const types = yield* deps.listTypes(map.project);
        return {
          snapshot: {
            map: map.metadata,
            steps: steps.records,
            artifacts: deriveArtifacts(steps.records, goals.records),
            goals: goals.records,
            types: types.records,
          },
          errors: [...steps.errors, ...goals.errors, ...types.errors],
        };
      }),
  };
}
