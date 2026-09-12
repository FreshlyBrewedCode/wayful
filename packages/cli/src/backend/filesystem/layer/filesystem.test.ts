import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MapHandle } from "@backend/MapStore";
import { MapMetadataError, WayfulError } from "@domain/errors";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import {
  backend,
  makeTemporaryDirectory,
  newStep,
  run,
  runFailure,
} from "@test/support/backend-harness";

const temporaryDirectory = makeTemporaryDirectory();

const mapDirectory = (map: MapHandle) => join(map.project.root, ".wayful", "maps", map.name);

/**
 * Assertions that only make sense against the filesystem: they simulate
 * corruption or inspect layout by reaching under the store, which the
 * parameterized MapStore contract (support/map-store-contract.ts) never
 * does. A future backend gets its own equivalent of this file rather than
 * reusing these.
 */
describe("FileSystemBackend: filesystem-specific behavior", () => {
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

  test("openMap raises MapMetadataError for malformed map.toml instead of a plain WayfulError", async () => {
    const map = await initializedMap();
    await writeFile(join(mapDirectory(map), "map.toml"), "not toml = [");
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.openMap(map.project, "plan");
      }),
    );
    expect(error).toBeInstanceOf(MapMetadataError);
  });

  test("listMaps skips maps with malformed metadata rather than failing outright", async () => {
    const map = await initializedMap();
    const invalidDir = join(map.project.root, ".wayful", "maps", "invalid");
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, "map.toml"), "not valid toml = [");
    const maps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listMaps(map.project);
      }),
    );
    expect(maps.records.map((m) => m.name)).toEqual(["plan"]);
    expect(maps.errors).toEqual([{ file: "invalid/map.toml", message: expect.any(String) }]);
  });

  test("createStep refuses to overwrite an existing step file", async () => {
    const map = await initializedMap();
    // Pre-create the file the next allocated id would write to, so
    // `createStep` collides without needing a prior successful create.
    await writeFile(join(mapDirectory(map), "steps", "1-work.md"), "---\nname: work\n");
    const error = await runFailure(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(map, newStep({ name: "work" }));
      }),
    );
    expect(error).toBeInstanceOf(WayfulError);
    expect((error as WayfulError).message).toContain("already exists");
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
    await writeFile(join(mapDirectory(map), "steps", "2-broken.md"), "---\nname: broken\n");
    const steps = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.listSteps(map);
      }),
    );
    expect(steps.records).toEqual([record]);
    expect(steps.errors).toEqual([{ file: "2-broken.md", message: expect.any(String) }]);
  });

  test("listSteps reports a step whose filename does not match its frontmatter identity", async () => {
    const map = await initializedMap();
    await writeFile(
      join(mapDirectory(map), "steps", "1-wrong.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: right\ntype: task\ndescription: Do it\nstatus: pending\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: 1970-01-01T00:00:00.000Z\nupdated_at: 1970-01-01T00:00:00.000Z\n---\n`,
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

  test("snapshot collects decode errors from steps, goals, and types instead of failing outright", async () => {
    const map = await initializedMap();
    await writeFile(join(mapDirectory(map), "steps", "1-broken.md"), "---\nname: broken\n");
    await writeFile(join(map.project.root, ".wayful", "types", "broken.md"), "not frontmatter");
    const result = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* b.snapshot(map);
      }),
    );
    expect(result.errors.map((e) => e.file).toSorted()).toEqual(["1-broken.md", "broken.md"]);
  });
});
