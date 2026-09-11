import { Context, type Effect } from "effect";

import type { MapMetadataError, WayfulError } from "../domain/errors";
import type {
  ArtifactContent,
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
  /**
   * The GitHub issue number a github-backed map resolves to — the native
   * address step and goal sub-issues are attached to and looked up under.
   * Absent under the filesystem backend, which recomputes a directory from
   * `project.root` + `name` instead.
   */
  readonly number?: number;
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

    /**
     * Dereferences a ref attached on `map` (ADR-0002). The readable set is
     * closed: a ref that is not attached anywhere on the map is refused, and
     * only markdown `file:` refs resolve. The filesystem implementation reads
     * through the filesystem; the GitHub implementation still resolves refs
     * against the local checkout, since project config and types already
     * require one.
     */
    readonly readArtifact: (
      map: MapHandle,
      ref: string,
    ) => Effect.Effect<ArtifactContent, WayfulError>;

    /**
     * Subscribes to changes in the project's records, invoking `onChange`
     * whenever something changed and returning a function that stops the
     * subscription. The event carries no detail — only that something did —
     * the same contract the server's SSE `changed` event exposes. The
     * filesystem implementation watches `.wayful`; the GitHub implementation
     * revalidates its records with conditional requests, so an idle project
     * spends no rate-limit budget.
     */
    readonly watch: (
      project: ProjectHandle,
      onChange: () => void,
    ) => Effect.Effect<() => void, WayfulError>;
  }
>()("wayful/MapStore") {}
