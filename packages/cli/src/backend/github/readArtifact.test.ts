import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { encodeIssueBody } from "@backend/github/issue";
import { mapIssueData } from "@backend/github/map";
import { stepIssueData } from "@backend/github/step";
import { MapStore, type MapHandle } from "@backend/MapStore";
import type { ProjectHandle } from "@backend/ProjectStore";
import { CURRENT_FORMAT_VERSION, type MapMetadata, type NewStepRecord } from "@domain/model";
import { ISSUE_TIME, graphqlIssue, graphqlIssueResponse } from "@test/support/github/issues";
import { runGithubMapStore } from "@test/support/github/store";

const roots: string[] = [];
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "wayful-github-refs-"));
  roots.push(root);
  return root;
}

const metadata: MapMetadata = {
  format_version: CURRENT_FORMAT_VERSION,
  name: "plan",
  start: "here",
  allowed_step_types: undefined,
  created_at: ISSUE_TIME,
  updated_at: ISSUE_TIME,
};

function mapHandle(root: string): MapHandle {
  const project: ProjectHandle = {
    root,
    description: "",
    backend: "github",
    repo: "acme/widgets",
  };
  return { project, name: "plan", metadata, number: 10 };
}

function outputStep(ref: string): NewStepRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    type: "task",
    name: "work",
    description: "A step",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [{ kind: "document", ref }],
    required_inputs: [],
    required_outputs: [],
    body: "",
  };
}

function snapshotResponse(ref: string) {
  const step = outputStep(ref);
  return graphqlIssueResponse({
    ...graphqlIssue(10, { title: "here", body: encodeIssueBody("", mapIssueData("plan")) }),
    subIssues: {
      nodes: [
        {
          ...graphqlIssue(11, {
            title: step.description,
            body: encodeIssueBody(step.body, stepIssueData(step)),
            labels: { nodes: [{ name: "wayful:step" }, { name: "wayful:type/task" }] },
          }),
          blockedBy: { nodes: [] },
        },
      ],
    },
  });
}

const write = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

describe("GithubMapStore: readArtifact", () => {
  test("dereferences a file: ref against the local checkout", async () => {
    const root = await temporaryRoot();
    await write(join(root, "docs", "spec.md"), "# From the checkout\n");
    const map = mapHandle(root);

    const content = await runGithubMapStore(
      () => snapshotResponse("file:docs/spec.md"),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.readArtifact(map, "file:docs/spec.md");
      }),
    );

    expect(content).toMatchObject({
      ref: "file:docs/spec.md",
      format: "markdown",
      content: "# From the checkout\n",
      truncated: false,
    });
  });

  test("fails with a clear error when the local checkout does not hold the file", async () => {
    const root = await temporaryRoot();
    const map = mapHandle(root);

    const error = await runGithubMapStore(
      () => snapshotResponse("file:docs/missing.md"),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.readArtifact(map, "file:docs/missing.md"));
      }),
    );

    expect(error.message).toContain("checked out locally");
  });

  test("refuses a ref that the network records do not attach on the map", async () => {
    const root = await temporaryRoot();
    await write(join(root, "docs", "orphan.md"), "orphan\n");
    const map = mapHandle(root);

    const error = await runGithubMapStore(
      () => snapshotResponse("file:docs/spec.md"),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.readArtifact(map, "file:docs/orphan.md"));
      }),
    );

    expect(error.message).toContain("is not attached on map 'plan'");
  });

  test("normalizes the ref before dereferencing", async () => {
    const root = await temporaryRoot();
    await write(join(root, "docs", "spec.md"), "normalized\n");
    const map = mapHandle(root);

    const content = await runGithubMapStore(
      () => snapshotResponse("file:docs/spec.md"),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.readArtifact(map, "file:./docs//spec.md");
      }),
    );

    expect(content.ref).toBe("file:docs/spec.md");
    expect(content.content).toBe("normalized\n");
  });
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
