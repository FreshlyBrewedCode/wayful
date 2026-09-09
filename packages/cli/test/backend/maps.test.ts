import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MapMetadataError, WayfulError } from "../../src/domain/errors";
import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { T0, backend, makeTemporaryDirectory, run, runFailure } from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

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
