import { Effect, FileSystem, Path } from "effect";

import { MapMetadataError, WayfulError } from "../../../../domain/errors";
import { identifier, nonEmpty } from "../../../../domain/identifier";
import { CURRENT_FORMAT_VERSION } from "../../../../domain/model";
import type { MapHandle, ProjectHandle } from "../../../Backend";
import { decodeMapMetadata } from "../../decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseToml,
  readTextFile,
  stringifyToml,
  writeAtomic,
} from "../../documents";
import { goalFile, goalsDir, mapDir, mapFile, mapsDir, stepsDir } from "../../paths";
import { accessError, collect, fail } from "../records";

export function makeMapOps(fs: FileSystem.FileSystem, path: Path.Path) {
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

  return {
    listMaps: (project: ProjectHandle) =>
      Effect.gen(function* () {
        const dir = mapsDir(path, project.root);
        const exists = yield* fs.exists(dir).pipe(Effect.mapError(accessError));
        if (!exists) return { records: [], errors: [] };
        const entries = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read project maps." })));
        const names: string[] = [];
        for (const name of entries.toSorted()) {
          const stat = yield* fs
            .stat(path.join(dir, name))
            .pipe(Effect.catch(() => Effect.succeed(undefined)));
          if (stat && stat.type === "Directory") names.push(name);
        }
        const result = yield* collect(
          names,
          (name) => `${name}/map.toml`,
          (name) => openMapHandle(project, name),
        );
        return {
          records: result.records.map((handle) => handle.metadata),
          errors: result.errors,
        };
      }),

    createMap: (
      project: ProjectHandle,
      {
        name,
        start,
        goal,
        goalBody,
      }: {
        readonly name: string;
        readonly start: string;
        readonly goal: string;
        readonly goalBody: string;
      },
    ) =>
      Effect.gen(function* () {
        // A map name can never be purely numeric: the reference grammar
        // distinguishes a bare integer (a step id) from a bare kebab-case
        // name (a map) without a backend lookup, which only holds if no
        // map can ever be named e.g. "123".
        yield* liftSync(() => identifier(name, "map name", true));
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
              outputs: [],
              required_outputs: [{ name: "evidence", kind: "artifact" }],
              created_at: now,
              updated_at: now,
            },
            goalBody,
          ),
        );
      }),

    openMap: (project: ProjectHandle, name: string) => openMapHandle(project, name),
  };
}
