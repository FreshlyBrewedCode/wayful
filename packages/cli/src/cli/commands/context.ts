import { Effect, Option, Result } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { liftSync } from "../../backend/filesystem/documents";
import {
  buildMapContext,
  parseSince,
  summarizeProjectMap,
  orderProjectMaps,
  type ProjectContextView,
} from "../../domain/context";
import type { DecodeError } from "../../domain/model";
import { parseReference } from "../../domain/reference";
import { buildSnapshot, fail, resolveMap, resolveProject } from "../../scope";
import { jsonFlag } from "../flags";
import { handle, printOutput } from "../render";
import { renderMapContext, renderProjectContext } from "../render-context";
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
    "Map name for map scope; omit for project scope. Step ('#N') and artifact ('@N') scope are not yet supported by this command",
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

        // A reference was given: bare-and-unqualified names a map, for map
        // scope. Anything else (a step or artifact reference, or a
        // map-qualified bare name) is a distinct, explicit rejection rather
        // than a silent fall-through to project scope — this is also what
        // keeps an unquoted `#1` mangled by a shell's `#`-comment handling
        // from being misread as "no argument" (bare `wayful context` is
        // always valid and always project scope, so that case can't be
        // detected after the fact; passing the reference correctly is what's
        // tested). Step and artifact scope are issue #8's.
        const reference = yield* liftSync(() => parseReference(ref.value));
        if (reference.kind !== "bare" || reference.map !== undefined)
          return yield* fail(
            "'wayful context' does not yet support step or artifact scope; pass a bare map name for map scope, or omit the argument for project scope.",
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
      }),
    ),
).pipe(
  Command.withDescription("Show project or map context: how things connect, and what to do next"),
);

export { contextCommand };
