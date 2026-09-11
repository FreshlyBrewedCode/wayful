import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { liftSync } from "../../backend/filesystem/documents";
import { normalizeRef } from "../../domain/artifact-ref";
import { buildSnapshot, fail, resolveMap, resolveProject } from "../../scope";
import { jsonFlag, mapFlag } from "../flags";
import { handle, printOutput } from "../render";
import { wayfulRoot } from "../root";

const artifactParent = Command.make("artifact").pipe(
  Command.withSharedFlags({ map: mapFlag }),
  Command.withDescription("Inspect map artifacts"),
);

const artifactArgument = Argument.string("ref").pipe(
  Argument.withMetavar("REF"),
  Argument.withDescription("Artifact reference, e.g. 'file:docs/spec.md' or 'https://...'"),
);

const artifactShowCommand = Command.make(
  "show",
  { ref: artifactArgument, json: jsonFlag },
  ({ ref, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const parent = yield* artifactParent;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const map = yield* resolveMap(parent.map, project);
        const normalizedRef = yield* liftSync(() => normalizeRef(ref));
        const { snapshot, errors } = yield* buildSnapshot(map);
        if (errors.length) return yield* fail(errors[0]!.message);
        const target = snapshot.artifacts.find((a) => a.ref === normalizedRef);
        if (!target) return yield* fail(`artifact '${normalizedRef}' does not exist.`);
        const human = [`Ref: ${target.ref}`, `Kind: ${target.kind}`].join("\n");
        yield* printOutput(json, target, human);
      }),
    ),
).pipe(Command.withDescription("Show an artifact"));

const artifactListCommand = Command.make("list", { json: jsonFlag }, ({ json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const parent = yield* artifactParent;
      const root = yield* wayfulRoot;
      const project = yield* resolveProject(root.project);
      const map = yield* resolveMap(parent.map, project);
      const { snapshot, errors } = yield* buildSnapshot(map);
      if (errors.length) return yield* fail(errors[0]!.message);
      const human = snapshot.artifacts.length
        ? snapshot.artifacts.map((a) => `- ${a.ref} (${a.kind})`).join("\n")
        : "- none";
      yield* printOutput(json, snapshot.artifacts, human);
    }),
  ),
).pipe(Command.withDescription("List every artifact attached in a map"));

export const artifactCommand = artifactParent.pipe(
  Command.withSubcommands([artifactShowCommand, artifactListCommand]),
);
