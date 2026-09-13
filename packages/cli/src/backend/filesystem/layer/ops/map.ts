import { Effect, FileSystem, Path } from "effect";

import { MapMetadataError, WayfulError } from "@domain/errors";
import { identifier, nonEmpty } from "@domain/identifier";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import type { MapHandle } from "@backend/MapStore";
import type { ProjectHandle } from "@backend/ProjectStore";
import { decodeMapMetadata } from "@backend/filesystem/decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseToml,
  readTextFile,
  stringifyToml,
  writeAtomic,
} from "@backend/filesystem/documents";
import { goalFile, goalsDir, mapDir, mapFile, mapsDir, stepsDir } from "@backend/filesystem/paths";
import { accessError, collect, fail } from "@backend/filesystem/layer/records";

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
      if (!exists) return yield* fail(`map '${name}' does not exist.`);
      const metadata = yield* Effect.gen(function* () {
        const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
        const data = yield* liftSync(() => parseToml(text, file));
        return yield* liftSync(() => decodeMapMetadata(data, name));
      }).pipe(Effect.mapError((error) => new MapMetadataError({ message: error.message })));
      return { project, name, metadata };
    });

  /**
   * The raw `map.toml` document behind a map, so a rewrite preserves fields
   * this layer does not model (`step_id_counter`). Decoding is left to the
   * caller; this only guarantees the file exists and parses as a TOML table.
   */
  const readMapDocument = (
    project: ProjectHandle,
    name: string,
  ): Effect.Effect<
    { readonly file: string; readonly data: Record<string, unknown> },
    WayfulError
  > =>
    Effect.gen(function* () {
      yield* liftSync(() => identifier(name, "map name"));
      const file = mapFile(path, mapDir(path, project.root, name));
      const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
      if (!exists) return yield* fail(`map '${name}' does not exist.`);
      const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
      const data = yield* liftSync(() => parseToml(text, file));
      if (!data || typeof data !== "object" || Array.isArray(data))
        return yield* fail(`malformed map metadata in ${file}.`);
      return { file, data: data as Record<string, unknown> };
    });

  /** Rewrites a map's metadata document, advancing `updated_at` from the injected clock. */
  const writeMapDocument = (
    file: string,
    data: Record<string, unknown>,
  ): Effect.Effect<void, WayfulError> =>
    Effect.gen(function* () {
      const now = yield* nowISO;
      yield* writeAtomic(fs, file, stringifyToml({ ...data, updated_at: now }));
    });

  return {
    listMaps: (project: ProjectHandle, options: { readonly includeArchived?: boolean } = {}) =>
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
            .pipe(Effect.orElseSucceed(() => undefined));
          if (stat && stat.type === "Directory") names.push(name);
        }
        const result = yield* collect(
          names,
          (name) => `${name}/map.toml`,
          (name) => openMapHandle(project, name),
        );
        const records = result.records.map((handle) => handle.metadata);
        return {
          records: options.includeArchived ? records : records.filter((map) => !map.archived),
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
        allowedStepTypes,
      }: {
        readonly name: string;
        readonly start: string;
        readonly goal: string;
        readonly goalBody: string;
        readonly allowedStepTypes?: readonly string[];
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
        if (exists) return yield* fail(`map '${name}' already exists.`);
        const onCreateError = new WayfulError({ message: `cannot create map '${name}'.` });
        yield* fs
          .makeDirectory(stepsDir(path, dir), { recursive: true })
          .pipe(Effect.mapError(() => onCreateError));
        yield* fs
          .makeDirectory(goalsDir(path, dir), { recursive: true })
          .pipe(Effect.mapError(() => onCreateError));
        const now = yield* nowISO;
        yield* writeAtomic(
          fs,
          mapFile(path, dir),
          stringifyToml({
            format_version: CURRENT_FORMAT_VERSION,
            name,
            start: trimmedStart,
            step_id_counter: 1,
            ...(allowedStepTypes !== undefined ? { allowed_step_types: allowedStepTypes } : {}),
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

    archiveMap: (project: ProjectHandle, name: string) =>
      Effect.gen(function* () {
        const { file, data } = yield* readMapDocument(project, name);
        if (data.archived_at !== undefined)
          return yield* fail(`map '${name}' is already archived.`);
        const now = yield* nowISO;
        yield* writeMapDocument(file, { ...data, archived_at: now });
      }),

    unarchiveMap: (project: ProjectHandle, name: string) =>
      Effect.gen(function* () {
        const { file, data } = yield* readMapDocument(project, name);
        if (data.archived_at === undefined) return yield* fail(`map '${name}' is not archived.`);
        const { archived_at: _archived, ...rest } = data;
        yield* writeMapDocument(file, rest);
      }),

    setAllowedStepTypes: (map: MapHandle, allowed: readonly string[] | undefined) =>
      Effect.gen(function* () {
        const { file, data } = yield* readMapDocument(map.project, map.name);
        const next = { ...data };
        if (allowed === undefined) delete next.allowed_step_types;
        else next.allowed_step_types = allowed;
        yield* writeMapDocument(file, next);
      }),
  };
}
