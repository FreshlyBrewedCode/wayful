import { BunServices } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";

import { MapStore } from "@backend/MapStore";
import { ProjectStore } from "@backend/ProjectStore";
import { FileSystemProjectStore } from "@backend/filesystem/layer";
import { MapMetadataError, WayfulError } from "@domain/errors";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import {
  T0,
  T1,
  backend,
  makeRunners,
  makeTemporaryDirectory,
  newStep,
} from "@test/support/backend-harness";

/**
 * Runs the behavioral contract every `MapStore` implementation must satisfy,
 * against the layer under test. `ProjectStore` stays filesystem-backed
 * regardless — per ADR, it is always disk — so only `mapStoreLayer` varies
 * between calls; this suite only reaches the store through its public API,
 * never a temp-directory path, so it applies unchanged to any backend.
 */
export function describeMapStoreContract(name: string, mapStoreLayer: Layer.Layer<MapStore>) {
  const testLayer = Layer.mergeAll(
    mapStoreLayer,
    FileSystemProjectStore.pipe(Layer.provide(BunServices.layer)),
  ).pipe(Layer.provideMerge(TestClock.layer()));

  const { run, runFailure } = makeRunners<MapStore | ProjectStore>(testLayer);
  const temporaryDirectory = makeTemporaryDirectory();

  async function initializedProject() {
    const directory = await temporaryDirectory();
    return run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
        return yield* b.openProject(Option.some(directory));
      }),
    );
  }

  async function initializedMap() {
    const project = await initializedProject();
    return run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
        return yield* b.openMap(project, "plan");
      }),
    );
  }

  describe(`MapStore contract: ${name}`, () => {
    describe("maps", () => {
      test("createMap then openMap round-trips metadata and the initial goal body", async () => {
        const project = await initializedProject();
        const result = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createMap(project, {
              name: "plan",
              start: "here",
              goal: "done",
              goalBody: "Notes.",
            });
            const map = yield* b.openMap(project, "plan");
            const goals = yield* b.listGoals(map);
            return { map, goals };
          }),
        );
        expect(result.map.metadata).toEqual({
          format_version: CURRENT_FORMAT_VERSION,
          name: "plan",
          start: "here",
          allowed_step_types: undefined,
          created_at: T0,
          updated_at: T0,
        });
        expect(result.goals.errors).toEqual([]);
        expect(result.goals.records).toEqual([
          {
            format_version: CURRENT_FORMAT_VERSION,
            name: "initial-goal",
            description: "done",
            outputs: [],
            required_outputs: [{ name: "evidence", kind: "artifact" }],
            body: "Notes.",
            created_at: T0,
            updated_at: T0,
          },
        ]);
      });

      test("createMap refuses to overwrite an existing map", async () => {
        const project = await initializedProject();
        await run(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createMap(project, {
              name: "plan",
              start: "here",
              goal: "done",
              goalBody: "",
            });
          }),
        );
        const error = await runFailure(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createMap(project, {
              name: "plan",
              start: "there",
              goal: "gone",
              goalBody: "",
            });
          }),
        );
        expect(error).toBeInstanceOf(WayfulError);
        expect((error as WayfulError).message).toContain("already exists");
      });

      test("openMap on a nonexistent map raises a plain WayfulError, not MapMetadataError", async () => {
        const project = await initializedProject();
        const error = await runFailure(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.openMap(project, "missing");
          }),
        );
        expect(error).toBeInstanceOf(WayfulError);
        expect(error).not.toBeInstanceOf(MapMetadataError);
        expect((error as WayfulError).message).toContain("does not exist");
      });
    });

    describe("steps", () => {
      test("createStep then listSteps round-trips and preserves the Markdown body", async () => {
        const map = await initializedMap();
        const created = newStep({
          name: "work",
          description: "Do it",
          body: "Line one.\nLine two.",
        });
        const { record, steps } = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            const persisted = yield* b.createStep(map, created);
            return { record: persisted, steps: yield* b.listSteps(map) };
          }),
        );
        expect(record).toEqual({ ...created, id: 1, created_at: T0, updated_at: T0 });
        expect(steps.errors).toEqual([]);
        expect(steps.records).toEqual([record]);
      });

      test("createStep allocates sequential ids and cannot allocate the same id for two concurrent calls", async () => {
        const map = await initializedMap();
        const records = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            return yield* Effect.all(
              [
                b.createStep(map, newStep({ name: "a" })),
                b.createStep(map, newStep({ name: "b" })),
                b.createStep(map, newStep({ name: "c" })),
              ],
              { concurrency: "unbounded" },
            );
          }),
        );
        expect(records.map((r) => r.id).toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
      });

      test("saveStep preserves created_at, advances updated_at from the injected clock, and leaves closed_at unset for a non-terminal status", async () => {
        const map = await initializedMap();
        const created = newStep({ name: "work", body: "Original body." });
        const steps = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            const persisted = yield* b.createStep(map, created);
            yield* TestClock.adjust("1 hour");
            yield* b.saveStep(map, { ...persisted, description: "Updated description" });
            return yield* b.listSteps(map);
          }),
        );
        expect(steps.errors).toEqual([]);
        expect(steps.records).toEqual([
          { ...created, id: 1, description: "Updated description", created_at: T0, updated_at: T1 },
        ]);
      });

      test("saveStep sets closed_at from the injected clock when a step becomes complete", async () => {
        const map = await initializedMap();
        const created = newStep({ name: "work" });
        const steps = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            const persisted = yield* b.createStep(map, created);
            yield* TestClock.adjust("1 hour");
            yield* b.saveStep(map, {
              ...persisted,
              status: "complete",
              completion_summary: "done",
            });
            return yield* b.listSteps(map);
          }),
        );
        expect(steps.errors).toEqual([]);
        expect(steps.records).toEqual([
          {
            ...created,
            id: 1,
            status: "complete",
            completion_summary: "done",
            created_at: T0,
            updated_at: T1,
            closed_at: T1,
          },
        ]);
      });
    });

    describe("goals", () => {
      test("createGoal then listGoals round-trips and preserves the Markdown body, saveGoal advances updated_at from the injected clock", async () => {
        const map = await initializedMap();
        const goals = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createGoal(map, {
              format_version: CURRENT_FORMAT_VERSION,
              name: "release",
              description: "Ship it",
              outputs: [],
              required_outputs: [{ name: "evidence", kind: "artifact" }],
              body: "Acceptance notes.",
            });
            const [, persisted] = (yield* b.listGoals(map)).records;
            yield* TestClock.adjust("1 hour");
            yield* b.saveGoal(map, {
              ...persisted,
              outputs: [{ slot: "evidence", ref: "file:proof.md" }],
            });
            return yield* b.listGoals(map);
          }),
        );
        expect(goals.errors).toEqual([]);
        expect(goals.records).toEqual([
          {
            format_version: CURRENT_FORMAT_VERSION,
            name: "initial-goal",
            description: "done",
            outputs: [],
            required_outputs: [{ name: "evidence", kind: "artifact" }],
            body: "",
            created_at: T0,
            updated_at: T0,
          },
          {
            format_version: CURRENT_FORMAT_VERSION,
            name: "release",
            description: "Ship it",
            outputs: [{ slot: "evidence", ref: "file:proof.md" }],
            required_outputs: [{ name: "evidence", kind: "artifact" }],
            body: "Acceptance notes.",
            created_at: T0,
            updated_at: T1,
          },
        ]);
      });

      test("createGoal refuses to overwrite an existing goal", async () => {
        const map = await initializedMap();
        await run(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createGoal(map, {
              format_version: CURRENT_FORMAT_VERSION,
              name: "release",
              description: "Ship it",
              outputs: [],
              required_outputs: [{ name: "evidence", kind: "artifact" }],
              body: "",
            });
          }),
        );
        const error = await runFailure(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createGoal(map, {
              format_version: CURRENT_FORMAT_VERSION,
              name: "release",
              description: "Ship it again",
              outputs: [],
              required_outputs: [{ name: "evidence", kind: "artifact" }],
              body: "",
            });
          }),
        );
        expect((error as WayfulError).message).toContain("already exists");
      });
    });

    describe("snapshot", () => {
      test("assembles steps, goals, types, and derived artifacts from a single read", async () => {
        const map = await initializedMap();
        const result = await run(
          Effect.gen(function* () {
            const b = yield* backend();
            yield* b.createStep(
              map,
              newStep({
                name: "work",
                outputs: [{ kind: "document", ref: "file:docs/spec.md" }],
              }),
            );
            return yield* b.snapshot(map);
          }),
        );
        expect(result.errors).toEqual([]);
        expect(result.snapshot.map).toEqual(map.metadata);
        expect(result.snapshot.steps).toHaveLength(1);
        expect(result.snapshot.steps[0]?.name).toBe("work");
        expect(result.snapshot.goals).toHaveLength(1);
        expect(result.snapshot.goals[0]?.name).toBe("initial-goal");
        expect(result.snapshot.types).toEqual([
          {
            format_version: CURRENT_FORMAT_VERSION,
            name: "task",
            description: "A general-purpose work step.",
            required_inputs: [],
            required_outputs: [],
            instructions: "",
          },
        ]);
        expect(result.snapshot.artifacts).toEqual([{ ref: "file:docs/spec.md", kind: "document" }]);
      });
    });
  });
}
