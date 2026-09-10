import { BunServices } from "@effect/platform-bun";
import { afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WayfulBackend } from "../../../src/backend/Backend";
import { FileSystemBackend } from "../../../src/backend/filesystem/layer";
import { CURRENT_FORMAT_VERSION, type NewStepRecord } from "../../../src/domain/model";

// TestClock.layer overrides the ambient Clock.Clock reference for the whole
// downstream effect, so every backend write inside a single `run`/`runFailure`
// call reads timestamps from the (deterministic, explicitly-advanced) test
// clock rather than the wall clock.
export const TestLayer = FileSystemBackend.pipe(
  Layer.provide(BunServices.layer),
  Layer.provideMerge(TestClock.layer()),
);

export function run<A, E>(effect: Effect.Effect<A, E, WayfulBackend>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)) as Effect.Effect<A, E, never>);
}

export function runFailure<A, E>(effect: Effect.Effect<A, E, WayfulBackend>): Promise<E> {
  return Effect.runPromise(
    effect.pipe(Effect.flip, Effect.provide(TestLayer)) as Effect.Effect<E, A, never>,
  );
}

export function backend() {
  return Effect.gen(function* () {
    return yield* WayfulBackend;
  });
}

// The TestClock starts at the Unix epoch, so a backend write that never
// advances the clock always produces this timestamp.
export const T0 = new Date(0).toISOString();
// One hour past the epoch, used to assert that `updated_at` (and `closed_at`)
// track an explicitly-advanced clock rather than staying pinned to `created_at`.
export const T1 = new Date(60 * 60 * 1000).toISOString();

export function newStep(
  overrides: Partial<NewStepRecord> & Pick<NewStepRecord, "name">,
): NewStepRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    type: "task",
    description: "A step",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [],
    required_outputs: [],
    body: "",
    ...overrides,
  };
}

/**
 * Builds one test file's isolated temp-directory tracker, with its own
 * `afterEach` cleanup registered against whichever file calls this. A shared
 * top-level `afterEach` in this module would only fire once — the first time
 * the module is imported — since ES modules are cached across test files;
 * calling it from inside a factory invoked at each file's top level re-runs
 * the registration, and cleanup, per file.
 */
export function makeTemporaryDirectory() {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  return async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), "wayful-backend-"));
    temporaryDirectories.push(directory);
    return directory;
  };
}
