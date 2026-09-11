import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { WayfulError } from "../../src/domain/errors";
import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import {
  T0,
  T1,
  backend,
  makeTemporaryDirectory,
  newStep,
  run,
  runFailure,
} from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

describe("FileSystemBackend: steps, artifacts, and goals", () => {
  async function initializedMap() {
    const directory = await temporaryDirectory();
    return run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
        const project = yield* b.openProject(Option.some(directory));
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
        return yield* b.openMap(project, "plan");
      }),
    );
  }

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

  test("listSteps returns a healthy step alongside a decode error for a broken sibling, rather than failing outright", async () => {
    const map = await initializedMap();
    const created = newStep({ name: "work" });
    const record = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.createStep(map, created);
      }),
    );
    await writeFile(join(map.dir, "steps", "2-broken.md"), "---\nname: broken\n");
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.records).toEqual([record]);
    expect(steps.errors).toEqual([{ file: "2-broken.md", message: expect.any(String) }]);
  });

  test("createStep refuses to overwrite an existing step file", async () => {
    const map = await initializedMap();
    // Pre-create the file the next allocated id would write to, so
    // `createStep` collides without needing a prior successful create.
    await writeFile(join(map.dir, "steps", "1-work.md"), "---\nname: work\n");
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, newStep({ name: "work" }));
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("already exists");
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

  test("listSteps reports a step whose filename does not match its frontmatter identity", async () => {
    const map = await initializedMap();
    await writeFile(
      join(map.dir, "steps", "1-wrong.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: right\ntype: task\ndescription: Do it\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: ${T0}\nupdated_at: ${T0}\n---\n`,
    );
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.records).toEqual([]);
    expect(steps.errors).toHaveLength(1);
    expect(steps.errors[0]?.message).toContain("does not match identity");
  });

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
