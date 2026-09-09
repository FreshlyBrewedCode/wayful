import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { backend, makeTemporaryDirectory, run } from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

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
