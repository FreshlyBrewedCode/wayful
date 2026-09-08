import { Context, type Effect, type Option } from "effect";

import type { MapMetadataError, WayfulError } from "../domain/errors";
import type {
  ArtifactRecord,
  GoalRecord,
  MapMetadata,
  NewArtifactRecord,
  NewGoalRecord,
  NewStepRecord,
  StepRecord,
  TypeDefinition,
} from "../domain/model";

export interface ProjectHandle {
  readonly root: string;
  /** The project's own description, as `wayful init --description` recorded it. */
  readonly description: string;
}

export interface MapHandle {
  readonly project: ProjectHandle;
  readonly name: string;
  readonly dir: string;
  readonly metadata: MapMetadata;
}

export class WayfulBackend extends Context.Service<
  WayfulBackend,
  {
    readonly initProject: (options: {
      readonly directory: string;
      readonly description: string;
    }) => Effect.Effect<void, WayfulError>;
    readonly openProject: (
      hint: Option.Option<string>,
    ) => Effect.Effect<ProjectHandle, WayfulError>;

    readonly listTypes: (
      project: ProjectHandle,
    ) => Effect.Effect<readonly TypeDefinition[], WayfulError>;
    readonly getType: (
      project: ProjectHandle,
      name: string,
    ) => Effect.Effect<TypeDefinition, WayfulError>;

    readonly listMaps: (
      project: ProjectHandle,
    ) => Effect.Effect<readonly MapMetadata[], WayfulError>;
    readonly createMap: (
      project: ProjectHandle,
      options: {
        readonly name: string;
        readonly start: string;
        readonly goal: string;
        readonly goalBody: string;
      },
    ) => Effect.Effect<void, WayfulError>;
    readonly openMap: (
      project: ProjectHandle,
      name: string,
    ) => Effect.Effect<MapHandle, WayfulError | MapMetadataError>;
    readonly setStepIdCounter: (map: MapHandle, next: number) => Effect.Effect<void, WayfulError>;
    readonly setArtifactIdCounter: (
      map: MapHandle,
      next: number,
    ) => Effect.Effect<void, WayfulError>;

    readonly listSteps: (map: MapHandle) => Effect.Effect<readonly StepRecord[], WayfulError>;
    readonly createStep: (map: MapHandle, step: NewStepRecord) => Effect.Effect<void, WayfulError>;
    readonly saveStep: (map: MapHandle, step: StepRecord) => Effect.Effect<void, WayfulError>;

    readonly listArtifacts: (
      map: MapHandle,
    ) => Effect.Effect<readonly ArtifactRecord[], WayfulError>;
    readonly createArtifact: (
      map: MapHandle,
      artifact: NewArtifactRecord,
    ) => Effect.Effect<void, WayfulError>;

    readonly listGoals: (map: MapHandle) => Effect.Effect<readonly GoalRecord[], WayfulError>;
    readonly createGoal: (map: MapHandle, goal: NewGoalRecord) => Effect.Effect<void, WayfulError>;
    readonly saveGoal: (map: MapHandle, goal: GoalRecord) => Effect.Effect<void, WayfulError>;
  }
>()("wayful/Backend") {}
