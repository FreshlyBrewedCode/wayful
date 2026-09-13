import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { join } from "node:path";

import { WayfulError } from "@domain/errors";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { backend, makeTemporaryDirectory, run, runFailure } from "@test/support/backend-harness";

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

  test("initProject defaults to the filesystem backend with no repo", async () => {
    const directory = await temporaryDirectory();
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({ directory, description: "" });
        return yield* b.openProject(Option.some(directory));
      }),
    );
    expect(project.backend).toBe("filesystem");
    expect(project.repo).toBeUndefined();
  });

  test("initProject persists a github backend and repo, and openProject round-trips them", async () => {
    const directory = await temporaryDirectory();
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({
          directory,
          description: "",
          backend: "github",
          repo: "acme/widgets",
        });
        return yield* b.openProject(Option.some(directory));
      }),
    );
    expect(project.backend).toBe("github");
    expect(project.repo).toBe("acme/widgets");
  });

  test("initProject persists the github host, and openProject round-trips it", async () => {
    const directory = await temporaryDirectory();
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({
          directory,
          description: "",
          backend: "github",
          repo: "acme/widgets",
          host: "github.example.com",
        });
        return yield* b.openProject(Option.some(directory));
      }),
    );
    expect(project.backend).toBe("github");
    expect(project.host).toBe("github.example.com");
  });

  test("openProject tolerates a github project with no recorded host, for the fallback", async () => {
    const directory = await temporaryDirectory();
    const project = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.initProject({
          directory,
          description: "",
          backend: "github",
          repo: "acme/widgets",
        });
        return yield* b.openProject(Option.some(directory));
      }),
    );
    expect(project.host).toBeUndefined();
  });

  test("rejects a host on a filesystem project and a malformed host", async () => {
    const cases: Array<{
      readonly backend: "filesystem" | "github";
      readonly host: string;
      readonly repo?: string;
    }> = [
      { backend: "filesystem", host: "github.com" },
      { backend: "github", host: "has a space", repo: "acme/widgets" },
      { backend: "github", host: "", repo: "acme/widgets" },
    ];
    for (const { backend: targetBackend, host, repo } of cases) {
      const directory = await temporaryDirectory();
      const error = await runFailure(
        Effect.gen(function* () {
          const b = yield* backend();
          yield* b.initProject({ directory, description: "", backend: targetBackend, repo, host });
          return yield* b.openProject(Option.some(directory));
        }),
      );
      expect(error).toBeInstanceOf(WayfulError);
      expect((error as WayfulError).message).toContain("host");
    }
  });
});
