import { BunServices } from "@effect/platform-bun";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WayfulBackend } from "../src/backend/Backend";
import { FileSystemBackend } from "../src/backend/filesystem/layer";
import { MapMetadataError, WayfulError } from "../src/domain/errors";
import type { StepRecord } from "../src/domain/model";

const TestLayer = FileSystemBackend.pipe(Layer.provide(BunServices.layer));
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

function step(overrides: Partial<StepRecord> & Pick<StepRecord, "id" | "name">): StepRecord {
  return {
    format_version: 1,
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
    expect(types).toEqual([
      {
        format_version: 1,
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
      format_version: 1,
      name: "plan",
      start: "here",
      step_id_counter: 1,
      allowed_step_types: undefined,
    });
    expect(result.goals).toEqual([
      {
        format_version: 1,
        name: "initial-goal",
        description: "done",
        evidence: [],
        body: "Notes.",
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
    expect(maps.map((m) => m.name)).toEqual(["plan"]);
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
    const created = step({
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
    expect(steps).toEqual([created]);
  });

  test("createStep refuses to overwrite an existing step file", async () => {
    const map = await initializedMap();
    const created = step({ id: 1, name: "work" });
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

  test("saveStep updates frontmatter while listSteps reflects the change and preserves the body", async () => {
    const map = await initializedMap();
    const created = step({ id: 1, name: "work", body: "Original body." });
    const updated: StepRecord = { ...created, description: "Updated description" };
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, created);
        yield* b.saveStep(map, updated);
        return yield* b.listSteps(map);
      }),
    );
    expect(steps).toEqual([updated]);
  });

  test("listSteps reports a step whose filename does not match its frontmatter identity", async () => {
    const map = await initializedMap();
    await writeFile(
      join(map.dir, "steps", "1-wrong.md"),
      "---\nformat_version: 1\nid: 1\nname: right\ntype: task\ndescription: Do it\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n---\n",
    );
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.listSteps(map);
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("does not match identity");
  });

  test("createArtifact refuses a name already used by a .yml or .yaml record", async () => {
    const map = await initializedMap();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: 1,
          name: "proof",
          kind: "document",
          ref: "git:one",
        });
      }),
    );
    const yamlError = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: 1,
          name: "proof",
          kind: "document",
          ref: "git:two",
        });
      }),
    );
    expect((yamlError as WayfulError).message).toContain("already exists");

    await writeFile(
      join(map.dir, "artifacts", "other.yml"),
      "format_version: 1\nname: other\nkind: document\nref: git:one\n",
    );
    const ymlError = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: 1,
          name: "other",
          kind: "document",
          ref: "git:two",
        });
      }),
    );
    expect((ymlError as WayfulError).message).toContain("already exists");
  });

  test("listArtifacts decodes both .yaml and .yml records sorted by name", async () => {
    const map = await initializedMap();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createArtifact(map, {
          format_version: 1,
          name: "zeta",
          kind: "document",
          ref: "git:z",
        });
      }),
    );
    await writeFile(
      join(map.dir, "artifacts", "alpha.yml"),
      "format_version: 1\nname: alpha\nkind: document\nref: git:a\n",
    );
    const artifacts = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listArtifacts(map);
      }),
    );
    expect(artifacts.map((a) => a.name)).toEqual(["alpha", "zeta"]);
  });

  test("createGoal then listGoals round-trips and preserves the Markdown body, saveGoal updates it", async () => {
    const map = await initializedMap();
    const goals = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createGoal(map, {
          format_version: 1,
          name: "release",
          description: "Ship it",
          evidence: [],
          body: "Acceptance notes.",
        });
        yield* b.saveGoal(map, {
          format_version: 1,
          name: "release",
          description: "Ship it",
          evidence: ["proof"],
          body: "Acceptance notes.",
        });
        return yield* b.listGoals(map);
      }),
    );
    expect(goals).toEqual([
      { format_version: 1, name: "initial-goal", description: "done", evidence: [], body: "" },
      {
        format_version: 1,
        name: "release",
        description: "Ship it",
        evidence: ["proof"],
        body: "Acceptance notes.",
      },
    ]);
  });

  test("createGoal refuses to overwrite an existing goal", async () => {
    const map = await initializedMap();
    await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createGoal(map, {
          format_version: 1,
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
          format_version: 1,
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
    expect(projectToml).toContain("format_version = 1");
  });
});
