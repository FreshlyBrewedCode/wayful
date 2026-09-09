import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { join } from "node:path";

import { WayfulError } from "../../src/domain/errors";
import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { backend, makeTemporaryDirectory, run, runFailure } from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

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
