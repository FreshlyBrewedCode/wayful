import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend, type MapHandle, type ProjectHandle } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import { qualifiedArtifactId } from "../../domain/context";
import { MapMetadataError, WayfulError } from "../../domain/errors";
import { identifier, nonEmpty } from "../../domain/identifier";
import { CURRENT_FORMAT_VERSION, type ArtifactRecord } from "../../domain/model";
import { parseArtifactAddress } from "../../domain/artifact-address";
import { describeToken, resolveToken, type ReferenceToken } from "../../domain/reference";
import {
  assertWritableMapIntegrity,
  fail,
  resolveMap,
  resolveProject,
  resolveReferencedMap,
  strict,
} from "../../scope";
import { jsonFlag, mapFlag } from "../flags";
import { handle, printOutput } from "../render";
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

const artifactArgument = Argument.string("artifact").pipe(
  Argument.withMetavar("ARTIFACT"),
  Argument.withDescription(
    "Artifact reference: a name, '@id', or '@name', optionally map-qualified ('map/name', 'map/@id')",
  ),
);

/**
 * Parses an artifact reference and resolves the map it addresses, mirroring
 * `step.ts`'s `resolveStepTarget`: a map prefix on the reference overrides
 * `--map`/`WAYFUL_MAP`, since it unambiguously names the map to target.
 */
function resolveArtifactTarget(
  reference: string,
  contextMap: Option.Option<string>,
  project: ProjectHandle,
): Effect.Effect<
  { readonly map: MapHandle; readonly token: ReferenceToken },
  WayfulError | MapMetadataError,
  WayfulBackend
> {
  return Effect.gen(function* () {
    const ref = yield* liftSync(() => parseArtifactAddress(reference));
    const map = yield* resolveReferencedMap(ref.map, contextMap, project);
    return { map, token: ref.token };
  });
}

function findArtifact(
  artifacts: readonly ArtifactRecord[],
  token: ReferenceToken,
): Effect.Effect<ArtifactRecord, WayfulError> {
  return Effect.gen(function* () {
    const found = resolveToken(token, artifacts);
    if (!found) return yield* fail(`artifact '${describeToken(token)}' does not exist.`);
    return found;
  });
}

const artifactShowCommand = Command.make(
  "show",
  { artifact: artifactArgument, json: jsonFlag },
  ({ artifact: reference, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const parent = yield* artifactParent;
        const backend = yield* WayfulBackend;
        const root = yield* wayfulRoot;
        const project = yield* resolveProject(root.project);
        const { map, token } = yield* resolveArtifactTarget(reference, parent.map, project);
        const artifacts = yield* strict(yield* backend.listArtifacts(map));
        const target = yield* findArtifact(artifacts, token);
        const qualifiedId = qualifiedArtifactId(map.metadata.name, target.id);
        const human = [
          `${qualifiedId} ${target.name}`,
          `Kind: ${target.kind}`,
          `Reference: ${target.ref}`,
          `Created: ${target.created_at}`,
          `Updated: ${target.updated_at}`,
        ].join("\n");
        yield* printOutput(json, { ...target, id: qualifiedId }, human);
      }),
    ),
).pipe(Command.withDescription("Show an artifact's full record"));

const artifactListCommand = Command.make("list", { json: jsonFlag }, ({ json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const parent = yield* artifactParent;
      const backend = yield* WayfulBackend;
      const root = yield* wayfulRoot;
      const project = yield* resolveProject(root.project);
      const map = yield* resolveMap(parent.map, project);
      const artifacts = yield* strict(yield* backend.listArtifacts(map));
      const sorted = artifacts
        .toSorted((a, b) => a.id - b.id)
        .map((a) => ({ ...a, id: qualifiedArtifactId(map.metadata.name, a.id) }));
      const human = sorted.length
        ? sorted.map((a) => `- ${a.id} ${a.name} (${a.kind}): ${a.ref}`).join("\n")
        : "- none";
      yield* printOutput(json, sorted, human);
    }),
  ),
).pipe(Command.withDescription("List every artifact on a map"));

export const artifactCommand = artifactParent.pipe(
  Command.withSubcommands([artifactAddCommand, artifactShowCommand, artifactListCommand]),
);
