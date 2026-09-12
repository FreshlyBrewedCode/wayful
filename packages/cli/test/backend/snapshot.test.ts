import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import { backend, makeTemporaryDirectory, newStep, run } from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

describe("FileSystemBackend: MapStore.snapshot", () => {
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

  test("collects decode errors from steps, goals, and types instead of failing outright", async () => {
    const map = await initializedMap();
    await writeFile(
      join(map.project.root, ".wayful", "maps", "plan", "steps", "1-broken.md"),
      "---\nname: broken\n",
    );
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
