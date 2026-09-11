import { Effect, FileSystem, Path, Semaphore } from "effect";

import { WayfulError } from "../../../../domain/errors";
import { closesStep, type NewStepRecord, type StepRecord } from "../../../../domain/model";
import type { MapHandle } from "../../../MapStore";
import { decodeStep } from "../../decode";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseFrontmatter,
  parseToml,
  readTextFile,
  stringifyToml,
  writeAtomic,
} from "../../documents";
import { mapDir, mapFile, stepFile, stepsDir } from "../../paths";
import { accessError, collect, fail, stepToDocument } from "../records";

export function makeStepOps(fs: FileSystem.FileSystem, path: Path.Path) {
  // Guards each map's `step_id_counter` read-modify-write so that two
  // concurrent `createStep` calls against the same map cannot allocate the
  // same id; scoped to this layer instance, one lock per map directory.
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockFor = (dir: string): Semaphore.Semaphore => {
    const existing = locks.get(dir);
    if (existing) return existing;
    const lock = Semaphore.makeUnsafe(1);
    locks.set(dir, lock);
    return lock;
  };

  const allocateStepId = (dir: string): Effect.Effect<number, WayfulError> =>
    Effect.gen(function* () {
      const file = mapFile(path, dir);
      const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
      const raw = (yield* liftSync(() => parseToml(text, file))) as Record<string, unknown>;
      const counter = raw.step_id_counter;
      if (!Number.isInteger(counter) || (counter as number) < 1)
        yield* fail("malformed map metadata.");
      yield* writeAtomic(
        fs,
        file,
        stringifyToml({ ...raw, step_id_counter: (counter as number) + 1 }),
      );
      return counter as number;
    });

  return {
    listSteps: (map: MapHandle) =>
      Effect.gen(function* () {
        const dir = stepsDir(path, mapDir(path, map.project.root, map.name));
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

    createStep: (map: MapHandle, step: NewStepRecord) => {
      const dir = mapDir(path, map.project.root, map.name);
      return lockFor(dir).withPermits(1)(
        Effect.gen(function* () {
          const id = yield* allocateStepId(dir);
          const file = stepFile(path, dir, id, step.name);
          const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
          if (exists) yield* fail(`step '${step.name}' already exists.`);
          const now = yield* nowISO();
          const record: StepRecord = {
            ...step,
            id,
            created_at: now,
            updated_at: now,
            closed_at: closesStep(step.status) ? now : undefined,
          };
          yield* writeAtomic(fs, file, buildMarkdown(stepToDocument(record), record.body));
          return record;
        }),
      );
    },

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
          stepFile(path, mapDir(path, map.project.root, map.name), record.id, record.name),
          buildMarkdown(stepToDocument(record), record.body),
        );
      }),
  };
}
