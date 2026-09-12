import { Context, type Effect } from "effect";

import type { MapMetadataError, WayfulError } from "../domain/errors";
import type {
  CollectionRead,
  DecodeError,
  GoalRecord,
  MapMetadata,
  MapSnapshot,
  NewGoalRecord,
  NewStepRecord,
  StepRecord,
} from "../domain/model";
import type { ProjectHandle } from "./ProjectStore";

/**
 * Pluggable: everything about a map's steps, goals, and their read shape.
 * `dir` is deliberately absent — a filesystem path is the interface's only
 * leak, and only `backend/filesystem/` needs it, recomputed from
 * `project.root` + `name`.
 */
export interface MapHandle {
  readonly project: ProjectHandle;
  readonly name: string;
  readonly metadata: MapMetadata;
}

export class MapStore extends Context.Service<
  MapStore,
  {
    readonly listMaps: (
      project: ProjectHandle,
    ) => Effect.Effect<CollectionRead<MapMetadata>, WayfulError>;
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

    readonly listSteps: (map: MapHandle) => Effect.Effect<CollectionRead<StepRecord>, WayfulError>;
    readonly createStep: (
      map: MapHandle,
      step: NewStepRecord,
    ) => Effect.Effect<StepRecord, WayfulError>;
    readonly saveStep: (map: MapHandle, step: StepRecord) => Effect.Effect<void, WayfulError>;

    readonly listGoals: (map: MapHandle) => Effect.Effect<CollectionRead<GoalRecord>, WayfulError>;
    readonly createGoal: (map: MapHandle, goal: NewGoalRecord) => Effect.Effect<void, WayfulError>;
    readonly saveGoal: (map: MapHandle, goal: GoalRecord) => Effect.Effect<void, WayfulError>;

    /**
     * Everything a map-scoped read is assembled from, in one query: over a
     * network this is one round trip where composing `listSteps`/`listGoals`/
     * `listTypes` separately would be three.
     */
    readonly snapshot: (
      map: MapHandle,
    ) => Effect.Effect<
      { readonly snapshot: MapSnapshot; readonly errors: readonly DecodeError[] },
      WayfulError
    >;
  }
>()("wayful/MapStore") {}
