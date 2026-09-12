import { BunServices } from "@effect/platform-bun";
import { afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MapStore } from "@backend/MapStore";
import { ProjectStore } from "@backend/ProjectStore";
import { FileSystemBackend } from "@backend/filesystem/layer";
import { CURRENT_FORMAT_VERSION, type NewStepRecord } from "@domain/model";

// TestClock.layer overrides the ambient Clock.Clock reference for the whole
// downstream effect, so every backend write inside a single `run`/`runFailure`
// call reads timestamps from the (deterministic, explicitly-advanced) test
// clock rather than the wall clock.
export const TestLayer = FileSystemBackend.pipe(
  Layer.provide(BunServices.layer),
  Layer.provideMerge(TestClock.layer()),
);

/**
 * Binds `run`/`runFailure` to a specific layer, so the parameterized
 * MapStore contract suite can supply the layer under test instead of always
 * reaching for the filesystem-pinned `TestLayer`.
 */
export function makeRunners<R>(layer: Layer.Layer<R>) {
  function run<A, E>(effect: Effect.Effect<A, E, R>): Promise<A> {
    return Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
  }

  function runFailure<A, E>(effect: Effect.Effect<A, E, R>): Promise<E> {
    return Effect.runPromise(
      effect.pipe(Effect.flip, Effect.provide(layer)) as Effect.Effect<E, A, never>,
    );
  }

  return { run, runFailure };
}

export const { run, runFailure } = makeRunners<MapStore | ProjectStore>(TestLayer);

export function backend() {
  return Effect.gen(function* () {
    const projectStore = yield* ProjectStore;
    const mapStore = yield* MapStore;
    return { ...projectStore, ...mapStore };
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
