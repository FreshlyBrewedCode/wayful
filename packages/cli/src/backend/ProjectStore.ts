import { Context, type Effect, type Option } from "effect";

import type { WayfulError } from "../domain/errors";
import type { CollectionRead, TypeDefinition } from "../domain/model";

/**
 * Always filesystem: project configuration and type definitions are meant to
 * live on disk and in version control, identically under every backend.
 */
export interface ProjectHandle {
  readonly root: string;
  /** The project's own description, as `wayful init --description` recorded it. */
  readonly description: string;
}

export class ProjectStore extends Context.Service<
  ProjectStore,
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
    ) => Effect.Effect<CollectionRead<TypeDefinition>, WayfulError>;
    readonly getType: (
      project: ProjectHandle,
      name: string,
    ) => Effect.Effect<TypeDefinition, WayfulError>;
  }
>()("wayful/ProjectStore") {}
