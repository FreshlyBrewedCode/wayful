import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { MAX_ARTIFACT_BYTES, readLocalArtifact } from "../../src/backend/artifacts";
import { backend, makeTemporaryDirectory, newStep, run } from "./support/harness";

const temporaryDirectory = makeTemporaryDirectory();

const write = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

describe("file: ref dereferencing (ADR-0002)", () => {
  test("reads a markdown file relative to the project root", async () => {
    const project = await temporaryDirectory();
    await write(join(project, "docs", "spec.md"), "# Spec\n\nHello.\n");

    const content = await Effect.runPromise(readLocalArtifact(project, "file:docs/spec.md"));

    expect(content).toEqual({
      ref: "file:docs/spec.md",
      format: "markdown",
      content: "# Spec\n\nHello.\n",
      truncated: false,
    });
  });

  test("rejects a ref that escapes the root with '..' before touching the filesystem", async () => {
    const project = await temporaryDirectory();
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:../outside.md")),
    );
    expect(error.message).toContain("may not contain '..' segments");
  });

  test("rejects an absolute file: ref through the shared classifier", async () => {
    const project = await temporaryDirectory();
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:/etc/passwd")),
    );
    expect(error.message).toContain("project-relative");
  });

  test("rejects a non-file: scheme", async () => {
    const project = await temporaryDirectory();
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "https://example.com/spec.md")),
    );
    expect(error.message).toContain("only file: refs");
  });

  test("rejects a non-markdown extension by allowlist", async () => {
    const project = await temporaryDirectory();
    await write(join(project, "docs", "secret.env"), "TOKEN=1\n");
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:docs/secret.env")),
    );
    expect(error.message).toContain("only .md and .markdown");
  });

  test("reports a missing file as an unreadable artifact, not a crash", async () => {
    const project = await temporaryDirectory();
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:docs/missing.md")),
    );
    expect(error.message).toContain("checked out locally");
  });

  test("refuses a symlink that escapes the project root", async () => {
    const base = await temporaryDirectory();
    const project = join(base, "project");
    await mkdir(join(project, "docs"), { recursive: true });
    await write(join(base, "outside.md"), "secret\n");
    await symlink(join(base, "outside.md"), join(project, "docs", "escape.md"));

    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:docs/escape.md")),
    );
    expect(error.message).toContain("outside the project root");
  });

  test("refuses a directory that happens to be named like markdown", async () => {
    const project = await temporaryDirectory();
    await mkdir(join(project, "docs", "dir.md"), { recursive: true });
    const error = await Effect.runPromise(
      Effect.flip(readLocalArtifact(project, "file:docs/dir.md")),
    );
    expect(error.message).toContain("not a regular file");
  });

  test("caps an oversized read and reports it as truncated", async () => {
    const project = await temporaryDirectory();
    await write(join(project, "docs", "big.md"), "a".repeat(MAX_ARTIFACT_BYTES + 100));

    const content = await Effect.runPromise(readLocalArtifact(project, "file:docs/big.md"));

    expect(content.truncated).toBe(true);
    expect(content.content).toHaveLength(MAX_ARTIFACT_BYTES);
  });
});

describe("MapStore.readArtifact: the readable set is closed", () => {
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

  test("reads a ref attached as a step output", async () => {
    const map = await initializedMap();
    await write(join(map.project.root, "docs", "spec.md"), "attached\n");
    const content = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        yield* b.createStep(
          map,
          newStep({ name: "work", outputs: [{ kind: "document", ref: "file:docs/spec.md" }] }),
        );
        return yield* b.readArtifact(map, "file:docs/spec.md");
      }),
    );
    expect(content.content).toBe("attached\n");
    expect(content.ref).toBe("file:docs/spec.md");
  });

  test("refuses a ref that exists on disk but is not attached on the map", async () => {
    const map = await initializedMap();
    await write(join(map.project.root, "docs", "orphan.md"), "orphan\n");
    const error = await run(
      Effect.gen(function* () {
        const b = yield* backend();
        return yield* Effect.flip(b.readArtifact(map, "file:docs/orphan.md"));
      }),
    );
    expect(error.message).toContain("is not attached on map 'plan'");
  });
});
