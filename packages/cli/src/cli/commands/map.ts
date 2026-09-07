import { Console, Effect, Result } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { WayfulBackend } from "../../backend/Backend";
import { MapMetadataError } from "../../domain/errors";
import { nextSteps } from "../../domain/graph";
import { mapStatus } from "../../domain/status";
import { validateMap } from "../../domain/validate";
import { buildSnapshot, resolveMap, resolveProject } from "../context";
import { jsonFlag, mapFlag } from "../flags";
import { bodyLines, handle, printOutput } from "../render";
import { wayfulRoot } from "../root";

const mapCreateCommand = Command.make(
  "create",
  {
    map: Flag.string("map").pipe(Flag.withMetavar("NAME"), Flag.withDescription("New map name")),
    start: Flag.string("start").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Starting point description"),
    ),
    goal: Flag.string("goal").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Initial goal description"),
    ),
    goalBody: Flag.string("goal-body").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Optional initial goal Markdown body"),
      Flag.withDefault(""),
    ),
  },
  ({ map, start, goal, goalBody }) =>
    handle(
      false,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const backend = yield* WayfulBackend;
        const p = yield* resolveProject(root.project);
        yield* backend.createMap(p, { name: map, start, goal, goalBody });
        yield* Console.log(`Created map '${map}'.`);
      }),
    ),
).pipe(Command.withDescription("Create a map"));

const mapListCommand = Command.make("list", { json: jsonFlag }, ({ json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const backend = yield* WayfulBackend;
      const p = yield* resolveProject(root.project);
      const maps = yield* backend.listMaps(p);
      yield* printOutput(json, maps, maps.map((m) => `${m.name}: ${m.start}`).join("\n"));
    }),
  ),
).pipe(Command.withDescription("List every map in the project"));

const mapValidateCommand = Command.make(
  "validate",
  { map: mapFlag, json: jsonFlag },
  ({ map, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const p = yield* resolveProject(root.project);
        const mapResult = yield* Effect.result(resolveMap(map, p));
        if (Result.isFailure(mapResult)) {
          if (mapResult.failure instanceof MapMetadataError) {
            yield* reportValidation(json, [mapResult.failure.message]);
            return;
          }
          return yield* Effect.fail(mapResult.failure);
        }
        const snapshotResult = yield* Effect.result(buildSnapshot(mapResult.success));
        if (Result.isFailure(snapshotResult)) {
          yield* reportValidation(json, [snapshotResult.failure.message]);
          return;
        }
        const errors = validateMap(snapshotResult.success, { includeProgress: true });
        yield* reportValidation(json, errors);
      }),
    ),
).pipe(Command.withDescription("Validate a map without modifying it"));

function reportValidation(json: boolean, errors: readonly string[]) {
  return Effect.gen(function* () {
    const value = { valid: errors.length === 0, errors };
    if (json) yield* Console.log(JSON.stringify(value, null, 2));
    else if (errors.length) yield* Console.error(`wayful: invalid map: ${errors.join(" ")}`);
    else yield* Console.log("Map is valid.");
    if (errors.length) process.exitCode = 1;
  });
}

const mapShowCommand = Command.make("show", { map: mapFlag, json: jsonFlag }, ({ map, json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const backend = yield* WayfulBackend;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const steps = yield* backend.listSteps(m);
      const artifacts = yield* backend.listArtifacts(m);
      const goals = yield* backend.listGoals(m);
      const value = { ...m.metadata, goals, artifacts, steps };
      const human = [
        `Map ${m.name}`,
        `Start: ${m.metadata.start}`,
        "Goals:",
        ...(goals.length
          ? goals.flatMap((g) => [`- ${g.name}: ${g.description}`, ...bodyLines(g.body, "  ")])
          : ["- none"]),
        "Artifacts:",
        ...(artifacts.length
          ? artifacts.map((a) => `- ${a.name} (${a.kind}): ${a.ref}`)
          : ["- none"]),
        "Steps:",
        ...(steps.length
          ? steps.flatMap((s) => [
              `- ${s.id} ${s.name}: ${s.description}`,
              ...bodyLines(s.body, "  "),
            ])
          : ["- none"]),
      ].join("\n");
      yield* printOutput(json, value, human);
    }),
  ),
).pipe(Command.withDescription("Show a map"));

const mapNextCommand = Command.make("next", { map: mapFlag, json: jsonFlag }, ({ map, json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const backend = yield* WayfulBackend;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const steps = yield* backend.listSteps(m);
      const artifacts = yield* backend.listArtifacts(m);
      const actionable = nextSteps(steps, artifacts);
      yield* printOutput(
        json,
        actionable,
        actionable.map((s) => `${s.id} ${s.name}: ${s.description}`).join("\n"),
      );
    }),
  ),
).pipe(Command.withDescription("List actionable pending steps"));

const mapStatusCommand = Command.make("status", { map: mapFlag, json: jsonFlag }, ({ map, json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const backend = yield* WayfulBackend;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const steps = yield* backend.listSteps(m);
      const artifacts = yield* backend.listArtifacts(m);
      const goals = yield* backend.listGoals(m);
      const status = mapStatus(m.metadata, steps, artifacts, goals);
      const human = [
        `Map ${status.map}`,
        `Goals: ${status.goals.satisfied}/${status.goals.total} satisfied`,
        `Steps: ${status.steps.pending} pending, ${status.steps.blocked} blocked, ${status.steps.complete} complete, ${status.steps.cancelled} cancelled`,
        "Blockers:",
        ...(status.blockers.length
          ? status.blockers.map((b) => `- ${b.id} ${b.name}: ${b.reason ?? "no reason recorded"}`)
          : ["- none"]),
        "Actionable steps:",
        ...(status.next.length
          ? status.next.map((s) => {
              const step = steps.find((candidate) => candidate.id === s.id)!;
              return `- ${step.id} ${step.name}: ${step.description}`;
            })
          : ["- none"]),
      ].join("\n");
      yield* printOutput(json, status, human);
    }),
  ),
).pipe(Command.withDescription("Show map status"));

export const mapCommand = Command.make("map").pipe(
  Command.withDescription("Create, inspect, and validate maps"),
  Command.withSubcommands([
    mapCreateCommand,
    mapListCommand,
    mapValidateCommand,
    mapShowCommand,
    mapNextCommand,
    mapStatusCommand,
  ]),
);
