import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { MapMetadataError, WayfulError } from "../../domain/errors";
import { identifier, nonEmpty } from "../../domain/identifier";
import {
  closesStep,
  CURRENT_FORMAT_VERSION,
  type ArtifactRecord,
  type GoalRecord,
  type MapMetadata,
  type NewArtifactRecord,
  type NewGoalRecord,
  type NewStepRecord,
  type StepRecord,
  type TypeDefinition,
} from "../../domain/model";
import { WayfulBackend, type MapHandle, type ProjectHandle } from "../Backend";
import {
  decodeArtifact,
  decodeGoal,
  decodeMapMetadata,
  decodeProjectMetadata,
  decodeStep,
  decodeType,
} from "./decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseFrontmatter,
  parseToml,
  parseYaml,
  readTextFile,
  stringifyToml,
  stringifyYaml,
  writeAtomic,
} from "./documents";
import {
  artifactFile,
  artifactsDir,
  goalFile,
  goalsDir,
  mapDir,
  mapFile,
  mapsDir,
  projectFile,
  stepFile,
  stepsDir,
  typeFile,
  typesDir,
} from "./paths";

// Effect.gen treats a bare `throw` as a defect, not a typed failure, so
// backend operations that need to short-circuit with a WayfulError must
// `yield* fail(...)` rather than call a throwing helper directly.
const fail = (message: string) => Effect.fail(new WayfulError({ message }));

const accessError = () => new WayfulError({ message: "cannot access filesystem." });

function mapMetadataToToml(metadata: MapMetadata): Record<string, unknown> {
  const record: Record<string, unknown> = {
    format_version: metadata.format_version,
    name: metadata.name,
    start: metadata.start,
    step_id_counter: metadata.step_id_counter,
    artifact_id_counter: metadata.artifact_id_counter,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
  };
  if (metadata.allowed_step_types !== undefined)
    record.allowed_step_types = metadata.allowed_step_types;
  return record;
}

function stepToDocument(step: StepRecord): Record<string, unknown> {
  const document: Record<string, unknown> = {
    format_version: CURRENT_FORMAT_VERSION,
    id: step.id,
    name: step.name,
    type: step.type,
    description: step.description,
    status: step.status,
    dependencies: step.dependencies,
    inputs: step.inputs,
    outputs: step.outputs,
    required_inputs: step.required_inputs,
    required_outputs: step.required_outputs,
    created_at: step.created_at,
    updated_at: step.updated_at,
  };
  if (step.completion_summary !== undefined) document.completion_summary = step.completion_summary;
  if (step.cancellation_reason !== undefined)
    document.cancellation_reason = step.cancellation_reason;
  if (step.block_reason !== undefined) document.block_reason = step.block_reason;
  if (step.closed_at !== undefined) document.closed_at = step.closed_at;
  return document;
}

function goalToDocument(goal: GoalRecord): Record<string, unknown> {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: goal.name,
    description: goal.description,
    evidence: goal.evidence,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };
}

export const FileSystemBackend = Layer.effect(
  WayfulBackend,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const discoverProjectRoot = (start: string): Effect.Effect<string, WayfulError> =>
      Effect.gen(function* () {
        let current = path.resolve(start);
        while (true) {
          const exists = yield* fs
            .exists(projectFile(path, current))
            .pipe(Effect.mapError(accessError));
          if (exists) return current;
          const parent = path.dirname(current);
          if (parent === current) break;
          current = parent;
        }
        return yield* fail("no Wayful project found; run 'wayful init' first.");
      });

    const readType = (
      project: ProjectHandle,
      name: string,
    ): Effect.Effect<TypeDefinition, WayfulError> =>
      Effect.gen(function* () {
        yield* liftSync(() => identifier(name, "type name"));
        const file = typeFile(path, project.root, name);
        const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
        if (!exists) yield* fail(`type '${name}' does not exist.`);
        const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
        const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
        return yield* liftSync(() => decodeType(name, data, body));
      });

    const openMapHandle = (
      project: ProjectHandle,
      name: string,
    ): Effect.Effect<MapHandle, WayfulError | MapMetadataError> =>
      Effect.gen(function* () {
        yield* liftSync(() => identifier(name, "map name"));
        const dir = mapDir(path, project.root, name);
        const file = mapFile(path, dir);
        const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
        if (!exists) yield* fail(`map '${name}' does not exist.`);
        const metadata = yield* Effect.gen(function* () {
          const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
          const data = yield* liftSync(() => parseToml(text, file));
          return yield* liftSync(() => decodeMapMetadata(data, name));
        }).pipe(
          Effect.catch((error) => Effect.fail(new MapMetadataError({ message: error.message }))),
        );
        return { project, name, dir, metadata };
      });

    return WayfulBackend.of({
      initProject: ({ directory, description }) =>
        Effect.gen(function* () {
          const root = path.resolve(directory);
          const wayfulDir = path.join(root, ".wayful");
          const exists = yield* fs.exists(wayfulDir).pipe(Effect.mapError(accessError));
          if (exists) yield* fail("Wayful state already exists; refusing to overwrite it.");
          const onCreateError = new WayfulError({ message: `cannot create ${root}.` });
          yield* fs
            .makeDirectory(typesDir(path, root), { recursive: true })
            .pipe(Effect.mapError(() => onCreateError));
          const now = yield* nowISO();
          yield* writeAtomic(
            fs,
            projectFile(path, root),
            stringifyToml({
              format_version: CURRENT_FORMAT_VERSION,
              description,
              created_at: now,
              updated_at: now,
            }),
          );
          yield* writeAtomic(
            fs,
            typeFile(path, root, "task"),
            buildMarkdown({
              format_version: CURRENT_FORMAT_VERSION,
              name: "task",
              description: "A general-purpose work step.",
              required_inputs: [],
              required_outputs: [],
            }),
          );
        }),

      openProject: (hint) =>
        Effect.gen(function* () {
          const start = Option.getOrElse(hint, () => process.cwd());
          const root = yield* discoverProjectRoot(start);
          const file = projectFile(path, root);
          const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
          const data = yield* liftSync(() => parseToml(text, file));
          const metadata = yield* liftSync(() => decodeProjectMetadata(data));
          return { root, description: metadata.description };
        }),

      listTypes: (project) =>
        Effect.gen(function* () {
          const dir = typesDir(path, project.root);
          const files = yield* fs
            .readDirectory(dir)
            .pipe(
              Effect.mapError(() => new WayfulError({ message: "cannot read project types." })),
            );
          const names = files
            .filter((file) => file.endsWith(".md"))
            .map((file) => file.slice(0, -3))
            .toSorted();
          const types: TypeDefinition[] = [];
          for (const name of names) types.push(yield* readType(project, name));
          return types;
        }),

      getType: (project, name) => readType(project, name),

      listMaps: (project) =>
        Effect.gen(function* () {
          const dir = mapsDir(path, project.root);
          const exists = yield* fs.exists(dir).pipe(Effect.mapError(accessError));
          if (!exists) return [];
          const entries = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read project maps." })));
          const names = entries.toSorted();
          const maps: MapMetadata[] = [];
          for (const name of names) {
            const stat = yield* fs
              .stat(path.join(dir, name))
              .pipe(Effect.catch(() => Effect.succeed(undefined)));
            if (!stat || stat.type !== "Directory") continue;
            const handle = yield* openMapHandle(project, name).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            );
            if (handle) maps.push(handle.metadata);
          }
          return maps;
        }),

      createMap: (project, { name, start, goal, goalBody }) =>
        Effect.gen(function* () {
          yield* liftSync(() => identifier(name, "map name"));
          const trimmedStart = yield* liftSync(() => nonEmpty(start, "map start"));
          const trimmedGoal = yield* liftSync(() => nonEmpty(goal, "map goal"));
          const dir = mapDir(path, project.root, name);
          const exists = yield* fs.exists(dir).pipe(Effect.mapError(accessError));
          if (exists) yield* fail(`map '${name}' already exists.`);
          const onCreateError = new WayfulError({ message: `cannot create map '${name}'.` });
          yield* fs
            .makeDirectory(stepsDir(path, dir), { recursive: true })
            .pipe(Effect.mapError(() => onCreateError));
          yield* fs
            .makeDirectory(artifactsDir(path, dir), { recursive: true })
            .pipe(Effect.mapError(() => onCreateError));
          yield* fs
            .makeDirectory(goalsDir(path, dir), { recursive: true })
            .pipe(Effect.mapError(() => onCreateError));
          const now = yield* nowISO();
          yield* writeAtomic(
            fs,
            mapFile(path, dir),
            stringifyToml({
              format_version: CURRENT_FORMAT_VERSION,
              name,
              start: trimmedStart,
              step_id_counter: 1,
              artifact_id_counter: 1,
              created_at: now,
              updated_at: now,
            }),
          );
          yield* writeAtomic(
            fs,
            goalFile(path, dir, "initial-goal"),
            buildMarkdown(
              {
                format_version: CURRENT_FORMAT_VERSION,
                name: "initial-goal",
                description: trimmedGoal,
                evidence: [],
                created_at: now,
                updated_at: now,
              },
              goalBody,
            ),
          );
        }),

      openMap: (project, name) => openMapHandle(project, name),

      setStepIdCounter: (map, next) =>
        Effect.gen(function* () {
          const now = yield* nowISO();
          yield* writeAtomic(
            fs,
            mapFile(path, map.dir),
            stringifyToml(
              mapMetadataToToml({ ...map.metadata, step_id_counter: next, updated_at: now }),
            ),
          );
        }),

      setArtifactIdCounter: (map, next) =>
        Effect.gen(function* () {
          const now = yield* nowISO();
          yield* writeAtomic(
            fs,
            mapFile(path, map.dir),
            stringifyToml(
              mapMetadataToToml({ ...map.metadata, artifact_id_counter: next, updated_at: now }),
            ),
          );
        }),

      listSteps: (map) =>
        Effect.gen(function* () {
          const dir = stepsDir(path, map.dir);
          const files = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read steps." })));
          const filenames = files.filter((file) => file.endsWith(".md")).toSorted();
          const steps: StepRecord[] = [];
          for (const filename of filenames) {
            const file = path.join(dir, filename);
            const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
            const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
            steps.push(yield* liftSync(() => decodeStep(filename, data, body)));
          }
          return steps.toSorted((a, b) => a.id - b.id);
        }),

      createStep: (map, step: NewStepRecord) =>
        Effect.gen(function* () {
          const file = stepFile(path, map.dir, step.id, step.name);
          const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
          if (exists) yield* fail(`step '${step.name}' already exists.`);
          const now = yield* nowISO();
          const record: StepRecord = {
            ...step,
            created_at: now,
            updated_at: now,
            closed_at: closesStep(step.status) ? now : undefined,
          };
          yield* writeAtomic(fs, file, buildMarkdown(stepToDocument(record), record.body));
        }),

      saveStep: (map, step) =>
        Effect.gen(function* () {
          const now = yield* nowISO();
          const record: StepRecord = {
            ...step,
            updated_at: now,
            closed_at: closesStep(step.status) ? now : undefined,
          };
          yield* writeAtomic(
            fs,
            stepFile(path, map.dir, record.id, record.name),
            buildMarkdown(stepToDocument(record), record.body),
          );
        }),

      listArtifacts: (map) =>
        Effect.gen(function* () {
          const dir = artifactsDir(path, map.dir);
          const files = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read artifacts." })));
          const filenames = files.filter((file) => /\.ya?ml$/.test(file));
          const artifacts: ArtifactRecord[] = [];
          for (const filename of filenames) {
            const file = path.join(dir, filename);
            const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
            const data = yield* liftSync(() => parseYaml(text, file));
            artifacts.push(yield* liftSync(() => decodeArtifact(filename, data)));
          }
          return artifacts.toSorted((a, b) => a.name.localeCompare(b.name));
        }),

      createArtifact: (map, artifact: NewArtifactRecord) =>
        Effect.gen(function* () {
          const yamlFile = artifactFile(path, map.dir, artifact.id, artifact.name, "yaml");
          const ymlFile = artifactFile(path, map.dir, artifact.id, artifact.name, "yml");
          const yamlExists = yield* fs.exists(yamlFile).pipe(Effect.mapError(accessError));
          const ymlExists = yield* fs.exists(ymlFile).pipe(Effect.mapError(accessError));
          if (yamlExists || ymlExists) yield* fail(`artifact '${artifact.name}' already exists.`);
          const now = yield* nowISO();
          yield* writeAtomic(
            fs,
            yamlFile,
            stringifyYaml({
              format_version: CURRENT_FORMAT_VERSION,
              id: artifact.id,
              name: artifact.name,
              kind: artifact.kind,
              ref: artifact.ref,
              created_at: now,
              updated_at: now,
            }),
          );
        }),

      listGoals: (map) =>
        Effect.gen(function* () {
          const dir = goalsDir(path, map.dir);
          const files = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read goals." })));
          const filenames = files.filter((file) => file.endsWith(".md")).toSorted();
          const goals: GoalRecord[] = [];
          for (const filename of filenames) {
            const file = path.join(dir, filename);
            const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
            const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
            goals.push(yield* liftSync(() => decodeGoal(filename, data, body)));
          }
          return goals.toSorted((a, b) => a.name.localeCompare(b.name));
        }),

      createGoal: (map, goal: NewGoalRecord) =>
        Effect.gen(function* () {
          const file = goalFile(path, map.dir, goal.name);
          const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
          if (exists) yield* fail(`goal '${goal.name}' already exists.`);
          const now = yield* nowISO();
          const record: GoalRecord = { ...goal, created_at: now, updated_at: now };
          yield* writeAtomic(fs, file, buildMarkdown(goalToDocument(record), record.body));
        }),

      saveGoal: (map, goal) =>
        Effect.gen(function* () {
          const now = yield* nowISO();
          const record: GoalRecord = { ...goal, updated_at: now };
          yield* writeAtomic(
            fs,
            goalFile(path, map.dir, record.name),
            buildMarkdown(goalToDocument(record), record.body),
          );
        }),
    });
  }),
);
