import { Effect, Option, Result } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import {
  buildArtifactContext,
  buildMapContext,
  buildStepContext,
  parseSince,
  summarizeProjectMap,
  orderProjectMaps,
  type ProjectContextView,
} from "../../domain/context";
import type { DecodeError } from "../../domain/model";
import { describeToken, parseReference, resolveToken } from "../../domain/reference";
import { buildSnapshot, fail, resolveMap, resolveProject, resolveReferencedMap } from "../../scope";
import { jsonFlag } from "../flags";
import { handle, printOutput } from "../render";
import {
  renderArtifactContext,
  renderMapContext,
  renderProjectContext,
  renderStepContext,
} from "../render-context";
import { wayfulRoot } from "../root";

const sinceFlag = Flag.string("since").pipe(
  Flag.withMetavar("WINDOW"),
  Flag.withDescription(
    "Limit recent activity and the completed-steps tail to a window: a duration ('7d', '24h') or an absolute date ('2026-09-01')",
  ),
  Flag.optional,
);

const refArgument = Argument.string("ref").pipe(
  Argument.withMetavar("REF"),
  Argument.withDescription(
    "Omit for project scope; a bare map name for map scope; a step ('#id'/'#name') or artifact ('@id'/'@name') reference for that scope, optionally map-qualified ('map/#id')",
  ),
  Argument.optional,
);

// Project scope reads every step, artifact, and goal of every map —
// accepted per issue #3's design notes, since the per-map step counts
// already force the full scan and last activity is free once that cost is
// paid. A map whose own metadata fails to decode, or whose snapshot fails to
// build, is reported as a problem and skipped rather than aborting the whole
// scope, mirroring `listMaps`'s own skip-and-collect tolerance for a broken
// sibling.
const contextCommand = Command.make(
  "context",
  { ref: refArgument, since: sinceFlag, json: jsonFlag },
  ({ ref, since, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const backend = yield* WayfulBackend;
        const project = yield* resolveProject(root.project);

        let sinceCutoff: Date | undefined;
        if (Option.isSome(since))
          sinceCutoff = yield* liftSync(() => parseSince(since.value, new Date()));

        if (Option.isNone(ref)) {
          const mapsRead = yield* backend.listMaps(project);
          const typesRead = yield* backend.listTypes(project);
          const problems: DecodeError[] = [...mapsRead.errors, ...typesRead.errors];
          const summaries = [];
          for (const mapMeta of mapsRead.records) {
            const mapResult = yield* Effect.result(backend.openMap(project, mapMeta.name));
            if (Result.isFailure(mapResult)) {
              problems.push({
                file: `${mapMeta.name}/map.toml`,
                message: mapResult.failure.message,
              });
              continue;
            }
            const snapshotResult = yield* Effect.result(buildSnapshot(mapResult.success));
            if (Result.isFailure(snapshotResult)) {
              problems.push({ file: mapMeta.name, message: snapshotResult.failure.message });
              continue;
            }
            const { snapshot, errors } = snapshotResult.success;
            problems.push(
              ...errors.map((e) => ({ file: `${mapMeta.name}/${e.file}`, message: e.message })),
            );
            summaries.push(
              summarizeProjectMap(snapshot.map, snapshot.steps, snapshot.artifacts, snapshot.goals),
            );
          }
          const view: ProjectContextView = {
            scope: "project",
            project: { description: project.description, root: project.root },
            maps: orderProjectMaps(summaries),
            types: typesRead.records.map((t) => ({ name: t.name, description: t.description })),
            problems,
          };
          yield* printOutput(json, view, renderProjectContext(view));
          return;
        }

        // A reference was given. Bare-and-unqualified names a map, for map
        // scope. This is also what keeps an unquoted `#1` mangled by a
        // shell's `#`-comment handling from being misread as "no argument"
        // (bare `wayful context` is always valid and always project scope,
        // so that case can't be detected after the fact; passing the
        // reference correctly is what's tested).
        const reference = yield* liftSync(() => parseReference(ref.value));

        if (reference.kind === "bare") {
          // A map-qualified bare name is genuinely ambiguous here — it could
          // name a step or an artifact in that map — and a bare name cannot
          // itself carry a map prefix (a map is the top-level scope). This is
          // a distinct, explicit rejection rather than a silent fall-through
          // to project scope.
          if (reference.map !== undefined)
            return yield* fail(
              `'${ref.value}' is ambiguous; use a bare map name for map scope, '#id'/'#name' for a step, or '@id'/'@name' for an artifact.`,
            );

          const map = yield* resolveMap(Option.some(reference.name), project);
          const { snapshot, errors } = yield* buildSnapshot(map);
          const view = buildMapContext({
            metadata: snapshot.map,
            steps: snapshot.steps,
            artifacts: snapshot.artifacts,
            goals: snapshot.goals,
            problems: errors,
            since: sinceCutoff,
          });
          yield* printOutput(json, view, renderMapContext(view));
          return;
        }

        if (reference.kind === "step") {
          const map = yield* resolveReferencedMap(reference.map, Option.none(), project);
          const { snapshot, errors } = yield* buildSnapshot(map);
          const target = resolveToken(reference.token, snapshot.steps);
          if (!target)
            return yield* fail(`step '${describeToken(reference.token)}' does not exist.`);
          const type = yield* backend.getType(project, target.type).pipe(
            Effect.map((t) => ({ name: t.name, description: t.description })),
            Effect.catch(() =>
              Effect.succeed({
                name: target.type,
                description: "unavailable: referenced type is missing or malformed.",
              }),
            ),
          );
          const view = buildStepContext({
            mapName: map.metadata.name,
            step: target,
            steps: snapshot.steps,
            artifacts: snapshot.artifacts,
            type,
            problems: errors,
          });
          yield* printOutput(json, view, renderStepContext(view));
          return;
        }

        // reference.kind === "artifact"
        const map = yield* resolveReferencedMap(reference.map, Option.none(), project);
        const { snapshot, errors } = yield* buildSnapshot(map);
        const target = resolveToken(reference.token, snapshot.artifacts);
        if (!target)
          return yield* fail(`artifact '${describeToken(reference.token)}' does not exist.`);
        const view = buildArtifactContext({
          mapName: map.metadata.name,
          artifact: target,
          steps: snapshot.steps,
          goals: snapshot.goals,
          problems: errors,
        });
        yield* printOutput(json, view, renderArtifactContext(view));
      }),
    ),
).pipe(
  Command.withDescription(
    "Show project, map, step, or artifact context: how things connect, and what to do next",
  ),
);

export { contextCommand };
