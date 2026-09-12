import { BunServices } from "@effect/platform-bun";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSystemProjectStore } from "../src/backend/filesystem/layer";
import { MapStore, type MapHandle } from "../src/backend/MapStore";
import { CURRENT_FORMAT_VERSION, type MapSnapshot } from "../src/domain/model";
import { startServer, type RunningServer } from "../src/server/http";

const FIXTURE_TIME = "2024-01-01T00:00:00.000Z";

const temporaryDirectories: string[] = [];
const running: RunningServer[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) server.stop();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "wayful-server-github-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * A GitHub-backed project fixture: the config alone, no records on disk, which
 * is what a machine reading maps from GitHub holds.
 */
async function githubProjectFixture() {
  const project = await temporaryDirectory();
  await mkdir(join(project, ".wayful"), { recursive: true });
  await writeFile(
    join(project, ".wayful", "project.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "GitHub fixture"\nbackend = "github"\nrepo = "acme/widgets"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
  );
  return project;
}

const metadata = {
  format_version: CURRENT_FORMAT_VERSION,
  name: "plan",
  start: "here",
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

const snapshot: MapSnapshot = {
  map: metadata,
  steps: [],
  artifacts: [],
  goals: [],
  types: [],
};

/**
 * A `MapStore` double whose `watch` is a controllable subscription: the server
 * must learn of changes through this seam, never by constructing a filesystem
 * watcher itself.
 */
const unused = () => Effect.die("not used by the server");

function stubMapStore() {
  const state = {
    subscriptions: 0,
    stopped: 0,
    notify: () => {},
  };
  const layer = Layer.succeed(
    MapStore,
    MapStore.of({
      listMaps: unused,
      createMap: unused,
      openMap: (_project, name) =>
        Effect.succeed({ project: _project, name, metadata } as MapHandle),
      listSteps: unused,
      createStep: unused,
      saveStep: unused,
      listGoals: unused,
      createGoal: unused,
      saveGoal: unused,
      snapshot: () => Effect.succeed({ snapshot, errors: [] }),
      readArtifact: unused,
      watch: (_project, onChange) =>
        Effect.sync(() => {
          state.subscriptions += 1;
          state.notify = onChange;
          return () => {
            state.stopped += 1;
          };
        }),
    }),
  );
  return { state, layer };
}

function serve(project: string, mapStore: Layer.Layer<MapStore>) {
  const layer = Layer.mergeAll(FileSystemProjectStore, mapStore).pipe(
    Layer.provide(BunServices.layer),
  );
  return Effect.runPromise(
    startServer({ project, host: "127.0.0.1", port: 0, client: undefined }).pipe(
      Effect.provide(layer),
    ),
  ).then((server) => {
    running.push(server);
    return server;
  });
}

const get = (server: RunningServer, path: string) => fetch(new URL(path, server.url));

describe("the server against a GitHub-backed project", () => {
  test("starts and serves /api/map from the backend's records", async () => {
    const project = await githubProjectFixture();
    const { layer } = stubMapStore();
    const server = await serve(project, layer);

    expect(server.found).toBe(true);
    const detail = (await (await get(server, "/api/map?name=plan")).json()) as {
      map: { name: string };
    };
    expect(detail.map.name).toBe("plan");
  });

  test("subscribes through the backend's watch and reports its changes as `changed`", async () => {
    const project = await githubProjectFixture();
    const { state, layer } = stubMapStore();
    const server = await serve(project, layer);

    const response = await get(server, "/api/events");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe("data: hello\n\n");

    state.notify();
    expect(decoder.decode((await reader.read()).value)).toContain("data: changed\n\n");

    await reader.cancel();
    server.stop();
    expect(state.subscriptions).toBe(1);
    expect(state.stopped).toBe(1);
  });
});
