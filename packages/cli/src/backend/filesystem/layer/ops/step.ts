import { Effect, FileSystem, Path } from "effect";

import { WayfulError } from "../../../../domain/errors";
import { closesStep, type NewStepRecord, type StepRecord } from "../../../../domain/model";
import type { MapHandle } from "../../../Backend";
import { decodeStep } from "../../decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseFrontmatter,
  readTextFile,
  writeAtomic,
} from "../../documents";
import { stepFile, stepsDir } from "../../paths";
import { accessError, collect, fail, stepToDocument } from "../records";

export function makeStepOps(fs: FileSystem.FileSystem, path: Path.Path) {
  return {
    listSteps: (map: MapHandle) =>
      Effect.gen(function* () {
        const dir = stepsDir(path, map.dir);
        const files = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read steps." })));
        const filenames = files.filter((file) => file.endsWith(".md")).toSorted();
        const result = yield* collect(
          filenames,
          (filename) => filename,
          (filename) =>
            Effect.gen(function* () {
              const file = path.join(dir, filename);
              const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
              const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
              return yield* liftSync(() => decodeStep(filename, data, body));
            }),
        );
        return {
          records: result.records.toSorted((a, b) => a.id - b.id),
          errors: result.errors,
        };
      }),

    createStep: (map: MapHandle, step: NewStepRecord) =>
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

    saveStep: (map: MapHandle, step: StepRecord) =>
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
  };
}
