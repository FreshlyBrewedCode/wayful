import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { identifier, nonEmpty } from "../../domain/identifier";
import { assertWritableMapIntegrity, resolveMap, resolveProject } from "../context";
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
        const resolvedName = yield* liftSync(() => identifier(name, "artifact name"));
        const resolvedKind = yield* liftSync(() => nonEmpty(kind, "artifact kind"));
        const resolvedRef = yield* liftSync(() => nonEmpty(ref, "artifact reference"));
        yield* backend.createArtifact(map, {
          format_version: 1,
          name: resolvedName,
          kind: resolvedKind,
          ref: resolvedRef,
        });
        yield* Console.log(`Added artifact '${resolvedName}'.`);
      }),
    ),
).pipe(Command.withDescription("Register an artifact"));

export const artifactCommand = artifactParent.pipe(Command.withSubcommands([artifactAddCommand]));
