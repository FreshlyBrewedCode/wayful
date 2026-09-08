import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { identifier, nonEmpty } from "../../domain/identifier";
import { CURRENT_FORMAT_VERSION } from "../../domain/model";
import { assertWritableMapIntegrity, fail, resolveMap, resolveProject, strict } from "../../scope";
import { mapFlag } from "../flags";
import { handle } from "../render";
import { wayfulRoot } from "../root";

const artifactParent = Command.make("artifact").pipe(
  Command.withSharedFlags({ map: mapFlag }),
  Command.withDescription("Register map artifacts"),
);

const artifactAddCommand = Command.make(
  "add",
  {
    name: Argument.string("name").pipe(
      Argument.withMetavar("NAME"),
      Argument.withDescription("Artifact name"),
    ),
    kind: Flag.string("kind").pipe(Flag.withMetavar("KIND"), Flag.withDescription("Artifact kind")),
    ref: Flag.string("ref").pipe(
      Flag.withMetavar("REF"),
      Flag.withDescription("Opaque artifact reference"),
    ),
  },
  ({ name, kind, ref }) =>
    handle(
      false,
      Effect.gen(function* () {
        const parent = yield* artifactParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        yield* assertWritableMapIntegrity(map);
        const artifacts = yield* strict(yield* backend.listArtifacts(map));
        const resolvedName = yield* liftSync(() => identifier(name, "artifact name"));
        if (artifacts.some((a) => a.name === resolvedName))
          yield* fail(`artifact '${resolvedName}' already exists.`);
        const resolvedKind = yield* liftSync(() => nonEmpty(kind, "artifact kind"));
        const resolvedRef = yield* liftSync(() => nonEmpty(ref, "artifact reference"));
        const highestArtifactID = artifacts.reduce((highest, a) => Math.max(highest, a.id), 0);
        const id = map.metadata.artifact_id_counter;
        if (id <= highestArtifactID)
          yield* fail("map artifact_id_counter must be greater than every existing artifact ID.");
        yield* backend.createArtifact(map, {
          format_version: CURRENT_FORMAT_VERSION,
          id,
          name: resolvedName,
          kind: resolvedKind,
          ref: resolvedRef,
        });
        yield* backend.setArtifactIdCounter(map, id + 1);
        yield* Console.log(`Added artifact '${resolvedName}'.`);
      }),
    ),
).pipe(Command.withDescription("Register an artifact"));

export const artifactCommand = artifactParent.pipe(Command.withSubcommands([artifactAddCommand]));
