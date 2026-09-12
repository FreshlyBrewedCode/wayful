import { Effect, FileSystem, Path } from "effect";

import { WayfulError } from "@domain/errors";
import type { GoalRecord, NewGoalRecord } from "@domain/model";
import type { MapHandle } from "@backend/MapStore";
import { decodeGoal } from "@backend/filesystem/decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseFrontmatter,
  readTextFile,
  writeAtomic,
} from "@backend/filesystem/documents";
import { goalFile, goalsDir, mapDir } from "@backend/filesystem/paths";
import { accessError, collect, fail, goalToDocument } from "@backend/filesystem/layer/records";

export function makeGoalOps(fs: FileSystem.FileSystem, path: Path.Path) {
  return {
    listGoals: (map: MapHandle) =>
      Effect.gen(function* () {
        const dir = goalsDir(path, mapDir(path, map.project.root, map.name));
        const files = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read goals." })));
        const filenames = files.filter((file) => file.endsWith(".md")).toSorted();
        const result = yield* collect(
          filenames,
          (filename) => filename,
          (filename) =>
            Effect.gen(function* () {
              const file = path.join(dir, filename);
              const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
              const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
              return yield* liftSync(() => decodeGoal(filename, data, body));
            }),
        );
        return {
          records: result.records.toSorted((a, b) => a.name.localeCompare(b.name)),
          errors: result.errors,
        };
      }),

    createGoal: (map: MapHandle, goal: NewGoalRecord) =>
      Effect.gen(function* () {
        const file = goalFile(path, mapDir(path, map.project.root, map.name), goal.name);
        const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
        if (exists) return yield* fail(`goal '${goal.name}' already exists.`);
        const now = yield* nowISO;
        const record: GoalRecord = { ...goal, created_at: now, updated_at: now };
        yield* writeAtomic(fs, file, buildMarkdown(goalToDocument(record), record.body));
      }),

    saveGoal: (map: MapHandle, goal: GoalRecord) =>
      Effect.gen(function* () {
        const now = yield* nowISO;
        const record: GoalRecord = { ...goal, updated_at: now };
        yield* writeAtomic(
          fs,
          goalFile(path, mapDir(path, map.project.root, map.name), record.name),
          buildMarkdown(goalToDocument(record), record.body),
        );
      }),
  };
}
