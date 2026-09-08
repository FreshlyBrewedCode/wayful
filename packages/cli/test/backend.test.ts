import { BunServices } from "@effect/platform-bun";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WayfulBackend } from "../src/backend/Backend";
import { FileSystemBackend } from "../src/backend/filesystem/layer";
import { MapMetadataError, WayfulError } from "../src/domain/errors";
import { CURRENT_FORMAT_VERSION } from "../src/domain/model";
import type { NewArtifactRecord, NewStepRecord } from "../src/domain/model";

// TestClock.layer overrides the ambient Clock.Clock reference for the whole
// downstream effect, so every backend write inside a single `run`/`runFailure`
// call reads timestamps from the (deterministic, explicitly-advanced) test
// clock rather than the wall clock.
const TestLayer = FileSystemBackend.pipe(
  Layer.provide(BunServices.layer),
  Layer.provideMerge(TestClock.layer()),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "wayful-backend-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run<A, E>(effect: Effect.Effect<A, E, WayfulBackend>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)) as Effect.Effect<A, E, never>);
}

function runFailure<A, E>(effect: Effect.Effect<A, E, WayfulBackend>): Promise<E> {
  return Effect.runPromise(
    effect.pipe(Effect.flip, Effect.provide(TestLayer)) as Effect.Effect<E, A, never>,
  );
}

function backend() {
  return Effect.gen(function* () {
    return yield* WayfulBackend;
  });
}

// The TestClock starts at the Unix epoch, so a backend write that never
// advances the clock always produces this timestamp.
const T0 = new Date(0).toISOString();
// One hour past the epoch, used to assert that `updated_at` (and `closed_at`)
// track an explicitly-advanced clock rather than staying pinned to `created_at`.
const T1 = new Date(60 * 60 * 1000).toISOString();

function newStep(
  overrides: Partial<NewStepRecord> & Pick<NewStepRecord, "id" | "name">,
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

describe("FileSystemBackend: project and type round-trips", () => {
  test("initProject then openProject round-trips and seeds the task type", async () => {
    const directory = await temporaryDirectory();
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "Fixture project" });
        return yield* b.openProject(Option.some(directory));
      }),
    );
    expect(project.root).toBe(directory);

    const types = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        const reopened = yield* b.openProject(Option.some(directory));
        return yield* b.listTypes(reopened);
      }),
    );
    expect(types.errors).toEqual([]);
    expect(types.records).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "task",
        description: "A general-purpose work step.",
        required_inputs: [],
        required_outputs: [],
        instructions: "",
      },
    ]);
  });

  test("initProject refuses to overwrite an existing project", async () => {
    const directory = await temporaryDirectory();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
      }),
    );
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("already exists");
  });

  test("openProject discovers upward from a nested directory", async () => {
    const directory = await temporaryDirectory();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
      }),
    );
    const nested = join(directory, "a", "b");
    await import("node:fs/promises").then((fs) => fs.mkdir(nested, { recursive: true }));
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.openProject(Option.some(nested));
      }),
    );
    expect(project.root).toBe(directory);
  });
});

describe("FileSystemBackend: maps", () => {
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
      step_id_counter: 1,
      artifact_id_counter: 1,
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
        evidence: [],
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
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
      }),
    );
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "there", goal: "gone", goalBody: "" });
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("already exists");
  });

  test("openMap raises MapMetadataError for malformed map.toml instead of a plain WayfulError", async () => {
    const project = await initializedProject();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
      }),
    );
    await writeFile(join(project.root, ".wayful", "maps", "plan", "map.toml"), "not toml = [");
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.openMap(project, "plan");
      }),
    );
    expect(error).toBeInstanceOf(MapMetadataError);
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

  test("setStepIdCounter persists the new counter for subsequent opens", async () => {
    const project = await initializedProject();
    const counter = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
        const map = yield* b.openMap(project, "plan");
        yield* b.setStepIdCounter(map, 5);
        const reopened = yield* b.openMap(project, "plan");
        return reopened.metadata.step_id_counter;
      }),
    );
    expect(counter).toBe(5);
  });

  test("setArtifactIdCounter persists the new counter for subsequent opens", async () => {
    const project = await initializedProject();
    const counter = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
        const map = yield* b.openMap(project, "plan");
        yield* b.setArtifactIdCounter(map, 7);
        const reopened = yield* b.openMap(project, "plan");
        return reopened.metadata.artifact_id_counter;
      }),
    );
    expect(counter).toBe(7);
  });

  test("listMaps skips maps with malformed metadata rather than failing outright", async () => {
    const project = await initializedProject();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
      }),
    );
    const invalidDir = join(project.root, ".wayful", "maps", "invalid");
    await import("node:fs/promises").then((fs) => fs.mkdir(invalidDir, { recursive: true }));
    await writeFile(join(invalidDir, "map.toml"), "not valid toml = [");
    const maps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listMaps(project);
      }),
    );
    expect(maps.records.map((m) => m.name)).toEqual(["plan"]);
    expect(maps.errors).toEqual([{ file: "invalid/map.toml", message: expect.any(String) }]);
  });
});

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
      id: 1,
      name: "work",
      description: "Do it",
      body: "Line one.\nLine two.",
    });
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.errors).toEqual([]);
    expect(steps.records).toEqual([{ ...created, created_at: T0, updated_at: T0 }]);
  });

  test("listSteps returns a healthy step alongside a decode error for a broken sibling, rather than failing outright", async () => {
    const map = await initializedMap();
    const created = newStep({ id: 1, name: "work" });
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
      }),
    );
    await writeFile(join(map.dir, "steps", "2-broken.md"), "---\nname: broken\n");
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.records).toEqual([{ ...created, created_at: T0, updated_at: T0 }]);
    expect(steps.errors).toEqual([{ file: "2-broken.md", message: expect.any(String) }]);
  });

  test("createStep refuses to overwrite an existing step file", async () => {
    const map = await initializedMap();
    const created = newStep({ id: 1, name: "work" });
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
      }),
    );
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("already exists");
  });

  test("saveStep preserves created_at, advances updated_at from the injected clock, and leaves closed_at unset for a non-terminal status", async () => {
    const map = await initializedMap();
    const created = newStep({ id: 1, name: "work", body: "Original body." });
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
        const [persisted] = (yield* b.listSteps(map)).records;
        yield* TestClock.adjust("1 hour");
        yield* b.saveStep(map, { ...persisted, description: "Updated description" });
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.errors).toEqual([]);
    expect(steps.records).toEqual([
      { ...created, description: "Updated description", created_at: T0, updated_at: T1 },
    ]);
  });

  test("saveStep sets closed_at from the injected clock when a step becomes complete", async () => {
    const map = await initializedMap();
    const created = newStep({ id: 1, name: "work" });
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
        const [persisted] = (yield* b.listSteps(map)).records;
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

  test("createArtifact refuses a name already used by a .yml or .yaml record", async () => {
    const map = await initializedMap();
    const artifact: NewArtifactRecord = {
      format_version: CURRENT_FORMAT_VERSION,
      id: 1,
      name: "proof",
      kind: "document",
      ref: "git:one",
    };
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, artifact);
      }),
    );
    const yamlError = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, { ...artifact, ref: "git:two" });
      }),
    );
    expect((yamlError as WayfulError).message).toContain("already exists");

    await writeFile(
      join(map.dir, "artifacts", "2-other.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 2\nname: other\nkind: document\nref: git:one\ncreated_at: ${T0}\nupdated_at: ${T0}\n`,
    );
    const ymlError = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: CURRENT_FORMAT_VERSION,
          id: 2,
          name: "other",
          kind: "document",
          ref: "git:two",
        });
      }),
    );
    expect((ymlError as WayfulError).message).toContain("already exists");
  });

  test("createArtifact writes an id-prefixed filename and stamps timestamps from the injected clock", async () => {
    const map = await initializedMap();
    const artifacts = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: CURRENT_FORMAT_VERSION,
          id: 3,
          name: "proof",
          kind: "document",
          ref: "git:abc",
        });
        return yield* b.listArtifacts(map);
      }),
    );
    const entries = await readdir(join(map.dir, "artifacts"));
    expect(entries).toContain("3-proof.yaml");
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.records).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        id: 3,
        name: "proof",
        kind: "document",
        ref: "git:abc",
        created_at: T0,
        updated_at: T0,
      },
    ]);
  });

  test("listArtifacts decodes both .yaml and .yml records sorted by name", async () => {
    const map = await initializedMap();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: CURRENT_FORMAT_VERSION,
          id: 1,
          name: "zeta",
          kind: "document",
          ref: "git:z",
        });
      }),
    );
    await writeFile(
      join(map.dir, "artifacts", "2-alpha.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 2\nname: alpha\nkind: document\nref: git:a\ncreated_at: ${T0}\nupdated_at: ${T0}\n`,
    );
    const artifacts = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listArtifacts(map);
      }),
    );
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.records.map((a) => a.name)).toEqual(["alpha", "zeta"]);
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
          evidence: [],
          body: "Acceptance notes.",
        });
        const [, persisted] = (yield* b.listGoals(map)).records;
        yield* TestClock.adjust("1 hour");
        yield* b.saveGoal(map, { ...persisted, evidence: ["proof"] });
        return yield* b.listGoals(map);
      }),
    );
    expect(goals.errors).toEqual([]);
    expect(goals.records).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "initial-goal",
        description: "done",
        evidence: [],
        body: "",
        created_at: T0,
        updated_at: T0,
      },
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "release",
        description: "Ship it",
        evidence: ["proof"],
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
          evidence: [],
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
          evidence: [],
          body: "",
        });
      }),
    );
    expect((error as WayfulError).message).toContain("already exists");
  });
});

describe("FileSystemBackend: atomic writes", () => {
  test("writes leave no leftover temp files behind", async () => {
    const directory = await temporaryDirectory();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
        const project = yield* b.openProject(Option.some(directory));
        yield* b.createMap(project, { name: "plan", start: "here", goal: "done", goalBody: "" });
      }),
    );
    const mapDirEntries = await readdir(join(directory, ".wayful", "maps", "plan"));
    expect(mapDirEntries.some((entry) => entry.includes(".tmp-"))).toBe(false);
    const projectToml = await readFile(join(directory, ".wayful", "project.toml"), "utf8");
    expect(projectToml).toContain(`format_version = ${CURRENT_FORMAT_VERSION}`);
  });
});
