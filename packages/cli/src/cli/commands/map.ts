import { Console, Effect, Option, Result, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { MapStore } from "@backend/MapStore";
import { ProjectStore, type ProjectHandle } from "@backend/ProjectStore";
import { liftSync } from "@backend/filesystem/documents";
import { MapMetadataError, WayfulError } from "@domain/errors";
import { deriveArtifacts, nextSteps } from "@domain/graph";
import { identifier } from "@domain/identifier";
import type { DecodeError } from "@domain/model";
import { mapStatus } from "@domain/status";
import { validateMap } from "@domain/validate";
import { buildSnapshot, fail, resolveMap, resolveMapName, resolveProject, strict } from "@/scope";
import { jsonFlag, mapFlag } from "@cli/flags";
import { bodyLines, handle, printOutput } from "@cli/render";
import { wayfulRoot } from "@cli/root";

/** Renders decode errors as an explicit section — omitted entirely when there are none, so degraded output is never confused with the ordinary case. */
function errorLines(errors: readonly DecodeError[]): string[] {
  return errors.length ? ["Errors:", ...errors.map((e) => `- ${e.file}: ${e.message}`)] : [];
}

/** Parses a comma-separated `--allowed-step-types` value into validated, unique type names. */
function parseAllowedStepTypes(raw: string): Effect.Effect<readonly string[], WayfulError> {
  return liftSync(() => {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0)
      throw new WayfulError({ message: "--allowed-step-types must name at least one type." });
    const names = parts.map((part) => identifier(part, "allowed step type"));
    if (new Set(names).size !== names.length)
      throw new WayfulError({ message: "--allowed-step-types repeats a type." });
    return names;
  });
}

/** Fails unless every name is one of the project's types, so a restriction can never name a phantom. */
function requireKnownTypes(
  project: ProjectHandle,
  names: readonly string[],
): Effect.Effect<void, WayfulError, ProjectStore> {
  return Effect.gen(function* () {
    const projectStore = yield* ProjectStore;
    const types = yield* strict(yield* projectStore.listTypes(project));
    const known = new Set(types.map((type) => type.name));
    for (const name of names) {
      if (!known.has(name)) return yield* fail(`type '${name}' does not exist.`);
    }
  });
}

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
    allowedStepTypes: Flag.string("allowed-step-types").pipe(
      Flag.withMetavar("CSV"),
      Flag.withDescription("Comma-separated step types this map permits (default: every type)"),
      Flag.optional,
    ),
  },
  ({ map, start, goal, goalBody, allowedStepTypes }) =>
    handle(
      false,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const mapStore = yield* MapStore;
        const p = yield* resolveProject(root.project);
        let allowed: readonly string[] | undefined;
        if (Option.isSome(allowedStepTypes)) {
          allowed = yield* parseAllowedStepTypes(allowedStepTypes.value);
          yield* requireKnownTypes(p, allowed);
        }
        yield* mapStore.createMap(p, {
          name: map,
          start,
          goal,
          goalBody,
          ...(allowed !== undefined ? { allowedStepTypes: allowed } : {}),
        });
        yield* Console.log(`Created map '${map}'.`);
      }),
    ),
).pipe(Command.withDescription("Create a map"));

const mapListCommand = Command.make(
  "list",
  {
    all: Flag.boolean("all").pipe(
      Flag.withDescription("Include archived maps"),
      Flag.withDefault(false),
    ),
    json: jsonFlag,
  },
  ({ all, json }) =>
    handle(
      json,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const mapStore = yield* MapStore;
        const p = yield* resolveProject(root.project);
        const maps = (yield* mapStore.listMaps(p, { includeArchived: all })).records;
        yield* printOutput(
          json,
          maps,
          maps.map((m) => `${m.name}${m.archived ? " (archived)" : ""}: ${m.start}`).join("\n"),
        );
      }),
    ),
).pipe(Command.withDescription("List every map in the project"));

const mapArchiveCommand = Command.make("archive", { map: mapFlag }, ({ map }) =>
  handle(
    false,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const mapStore = yield* MapStore;
      const p = yield* resolveProject(root.project);
      const name = yield* resolveMapName(map);
      yield* mapStore.archiveMap(p, name);
      yield* Console.log(`Archived map '${name}'.`);
    }),
  ),
).pipe(Command.withDescription("Archive a map, keeping its steps and goals"));

const mapUnarchiveCommand = Command.make("unarchive", { map: mapFlag }, ({ map }) =>
  handle(
    false,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const mapStore = yield* MapStore;
      const p = yield* resolveProject(root.project);
      const name = yield* resolveMapName(map);
      yield* mapStore.unarchiveMap(p, name);
      yield* Console.log(`Restored map '${name}'.`);
    }),
  ),
).pipe(Command.withDescription("Restore an archived map with its steps and goals"));

const mapRestrictCommand = Command.make(
  "restrict",
  {
    map: mapFlag,
    allowedStepTypes: Flag.string("allowed-step-types").pipe(
      Flag.withMetavar("CSV"),
      Flag.withDescription("Comma-separated step types this map permits"),
      Flag.optional,
    ),
    clear: Flag.boolean("clear").pipe(
      Flag.withDescription("Remove the restriction, permitting every type"),
      Flag.withDefault(false),
    ),
  },
  ({ map, allowedStepTypes, clear }) =>
    handle(
      false,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const mapStore = yield* MapStore;
        const p = yield* resolveProject(root.project);
        if (clear && Option.isSome(allowedStepTypes))
          return yield* fail("--clear and --allowed-step-types are mutually exclusive.");
        if (!clear && Option.isNone(allowedStepTypes))
          return yield* fail("pass --allowed-step-types to restrict, or --clear to remove it.");
        const target = yield* resolveMap(map, p);
        if (clear) {
          yield* mapStore.setAllowedStepTypes(target, undefined);
          yield* Console.log(`Cleared the type restriction on map '${target.name}'.`);
        } else {
          const allowed = yield* parseAllowedStepTypes(Option.getOrThrow(allowedStepTypes));
          yield* requireKnownTypes(p, allowed);
          yield* mapStore.setAllowedStepTypes(target, allowed);
          yield* Console.log(`Restricted map '${target.name}' to types: ${allowed.join(", ")}.`);
        }
      }),
    ),
).pipe(Command.withDescription("Set or clear a map's allowed step types"));

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
          return yield* mapResult.failure;
        }
        const snapshotResult = yield* Effect.result(buildSnapshot(mapResult.success));
        if (Result.isFailure(snapshotResult)) {
          yield* reportValidation(json, [snapshotResult.failure.message]);
          return;
        }
        const { snapshot, errors: readErrors } = snapshotResult.success;
        // Decode errors are blocking here — unlike `map show`/`status`/`next` —
        // and every malformed file is reported, not just the first.
        const validationErrors = validateMap(snapshot, { includeProgress: true });
        const errors = [...readErrors.map((e) => `${e.file}: ${e.message}`), ...validationErrors];
        yield* reportValidation(json, errors);
      }),
    ),
).pipe(Command.withDescription("Validate a map without modifying it"));

const validationOutputJson = Schema.fromJsonString(
  Schema.Struct({ valid: Schema.Boolean, errors: Schema.Array(Schema.String) }),
  { space: 2 },
);

function reportValidation(json: boolean, errors: readonly string[]) {
  return Effect.gen(function* () {
    const value = { valid: errors.length === 0, errors };
    if (json)
      yield* Console.log(
        yield* Schema.encodeEffect(validationOutputJson)(value).pipe(Effect.orDie),
      );
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
      const mapStore = yield* MapStore;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const stepsRead = yield* mapStore.listSteps(m);
      const goalsRead = yield* mapStore.listGoals(m);
      const steps = stepsRead.records;
      const goals = goalsRead.records;
      const artifacts = deriveArtifacts(steps, goals);
      // A broken sibling never hides a healthy one: render everything that
      // decoded, and report everything that didn't, rather than failing.
      const errors = [...stepsRead.errors, ...goalsRead.errors];
      const value = { ...m.metadata, goals, artifacts, steps, errors };
      const human = [
        `Map ${m.name}`,
        `Start: ${m.metadata.start}`,
        `Allowed step types: ${m.metadata.allowed_step_types?.join(", ") ?? "(all)"}`,
        "Goals:",
        ...(goals.length
          ? goals.flatMap((g) => [`- ${g.name}: ${g.description}`, ...bodyLines(g.body, "  ")])
          : ["- none"]),
        "Artifacts:",
        ...(artifacts.length ? artifacts.map((a) => `- ${a.ref} (${a.kind})`) : ["- none"]),
        "Steps:",
        ...(steps.length
          ? steps.flatMap((s) => [
              `- ${s.id} ${s.name}: ${s.description}`,
              ...bodyLines(s.body, "  "),
            ])
          : ["- none"]),
        ...errorLines(errors),
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
      const mapStore = yield* MapStore;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const stepsRead = yield* mapStore.listSteps(m);
      const errors = [...stepsRead.errors];
      const actionable = nextSteps(stepsRead.records);
      yield* printOutput(
        json,
        { steps: actionable, errors },
        [
          ...actionable.map((s) => `${s.id} ${s.name}: ${s.description}`),
          ...errorLines(errors),
        ].join("\n"),
      );
    }),
  ),
).pipe(Command.withDescription("List actionable pending steps"));

const mapStatusCommand = Command.make("status", { map: mapFlag, json: jsonFlag }, ({ map, json }) =>
  handle(
    json,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const p = yield* resolveProject(root.project);
      const m = yield* resolveMap(map, p);
      const { snapshot, errors } = yield* buildSnapshot(m);
      const status = mapStatus(snapshot.map, snapshot.steps, snapshot.goals);
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
              const step = snapshot.steps.find((candidate) => candidate.id === s.id)!;
              return `- ${step.id} ${step.name}: ${step.description}`;
            })
          : ["- none"]),
        ...errorLines(errors),
      ].join("\n");
      yield* printOutput(json, { ...status, errors }, human);
    }),
  ),
).pipe(Command.withDescription("Show map status"));

export const mapCommand = Command.make("map").pipe(
  Command.withDescription("Create, inspect, and validate maps"),
  Command.withSubcommands([
    mapCreateCommand,
    mapListCommand,
    mapArchiveCommand,
    mapUnarchiveCommand,
    mapRestrictCommand,
    mapValidateCommand,
    mapShowCommand,
    mapNextCommand,
    mapStatusCommand,
  ]),
);
