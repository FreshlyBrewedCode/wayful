import { BunServices } from "@effect/platform-bun";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSystemBackend } from "@backend/filesystem/layer";
import type { WayfulError } from "@domain/errors";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { clientDirectory, resolveClientAssets } from "@server/client";
import { EMBEDDED_ASSETS } from "@server/embedded-ui";
import { startServer, type RunningServer, type ServerConfig } from "@server/http";

const TestLayer = FileSystemBackend.pipe(Layer.provide(BunServices.layer));
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
  const directory = await mkdtemp(join(tmpdir(), "wayful-server-"));
  temporaryDirectories.push(directory);
  return directory;
}

// A fixed timestamp for these hand-authored fixtures, so structural
// assertions below can compare exact `created_at`/`updated_at` values rather
// than merely their shape.
const FIXTURE_TIME = "2024-01-01T00:00:00.000Z";

/**
 * Writes documented on-disk input directly; the server under test is the only
 * thing that reads it, so a fixture bug cannot be hidden by the code it tests.
 */
async function projectFixture() {
  const project = await temporaryDirectory();
  const map = join(project, ".wayful", "maps", "plan");
  await mkdir(join(map, "steps"), { recursive: true });
  await mkdir(join(map, "goals"), { recursive: true });
  await mkdir(join(project, ".wayful", "types"), { recursive: true });
  await writeFile(
    join(project, ".wayful", "project.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "Fixture project"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
  );
  await writeFile(
    join(map, "map.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\nname = "plan"\nstart = "here"\nstep_id_counter = 3\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
  );
  await writeFile(
    join(project, ".wayful", "types", "task.md"),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: task\ndescription: Fixture type\nrequired_inputs: []\nrequired_outputs: []\n---\nUse primary sources.\n`,
  );
  await writeFile(
    join(map, "steps", "1-work.md"),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: work\ntype: task\ndescription: Do it\nstatus: pending\ndependencies: []\ninputs: []\noutputs: [{"ref":"git:abc","kind":"document"}]\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\nStep narrative.\n`,
  );
  await writeFile(
    join(map, "steps", "2-waiting.md"),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 2\nname: waiting\ntype: task\ndescription: Wait\nstatus: blocked\nblock_reason: Awaiting approval\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\n`,
  );
  await writeFile(
    join(map, "goals", "initial-goal.md"),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: initial-goal\ndescription: Ship it\noutputs: []\nrequired_outputs: [{"name":"evidence","kind":"artifact"}]\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\nAcceptance notes.\n`,
  );
  return project;
}

function serve(config: Partial<ServerConfig> & Pick<ServerConfig, "project">) {
  return Effect.runPromise(
    startServer({ host: "127.0.0.1", port: 0, client: undefined, ...config }).pipe(
      Effect.provide(TestLayer),
    ) as Effect.Effect<RunningServer, WayfulError, never>,
  ).then((server) => {
    running.push(server);
    return server;
  });
}

const get = (server: RunningServer, path: string) => fetch(new URL(path, server.url));

// Payload shapes are asserted structurally here rather than through the API's
// own types, so a change to those types cannot quietly change what is checked.
const json = (server: RunningServer, path: string): Promise<any> =>
  get(server, path).then((response) => response.json());

describe("the JSON API the viewer requires", () => {
  test("overview reports the project, every map with its status, and the project types", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    const overview = await json(server, "/api/overview");

    expect(overview.project).toEqual({ root: project, description: "Fixture project" });
    expect(overview.maps).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "plan",
        start: "here",
        created_at: FIXTURE_TIME,
        updated_at: FIXTURE_TIME,
        status: {
          map: "plan",
          goals: { satisfied: 0, total: 1 },
          steps: { pending: 1, blocked: 1, complete: 0, cancelled: 0 },
          blockers: [{ id: 2, name: "waiting", reason: "Awaiting approval" }],
          next: [{ id: 1, name: "work" }],
        },
      },
    ]);
    expect(overview.types).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "task",
        description: "Fixture type",
        required_inputs: [],
        required_outputs: [],
        instructions: "Use primary sources.\n",
      },
    ]);
  });

  test("map composes show, status, next, and validate into one response", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    const detail = await json(server, "/api/map?name=plan");

    expect(detail.map.name).toBe("plan");
    expect(detail.map.start).toBe("here");
    expect(detail.map.goals).toEqual([
      {
        format_version: CURRENT_FORMAT_VERSION,
        name: "initial-goal",
        description: "Ship it",
        outputs: [],
        required_outputs: [{ name: "evidence", kind: "artifact" }],
        body: "Acceptance notes.\n",
        created_at: FIXTURE_TIME,
        updated_at: FIXTURE_TIME,
      },
    ]);
    expect(detail.map.artifacts).toEqual([{ ref: "git:abc", kind: "document" }]);
    expect(detail.map.steps.map((step: { id: number }) => step.id)).toEqual([1, 2]);
    expect(detail.status.steps).toEqual({ pending: 1, blocked: 1, complete: 0, cancelled: 0 });
    expect(detail.next).toEqual([1]);
    // `map validate`'s own findings, progress included — unfinished work is a
    // finding there, and the viewer's findings panel must say what the CLI says.
    expect(detail.validation).toEqual({
      valid: false,
      errors: [
        "step 'work' remains pending.",
        "step 'waiting' is blocked.",
        "goal 'initial-goal' is not satisfied.",
      ],
    });
  });

  test("map reports findings for a map that is readable but invalid", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "steps", "1-work.md"),
      `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: work\ntype: task\ndescription: Do it\nstatus: pending\ndependencies: []\ninputs:\n  - ref: git:orphan\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\n`,
    );
    const server = await serve({ project });

    const detail = await json(server, "/api/map?name=plan");

    expect(detail.validation.valid).toBe(false);
    expect(detail.validation.errors.join(" ")).toContain("has an invalid inputs attachment");
  });

  test("map reports the CLI's own message for a map it cannot read", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    expect(await json(server, "/api/map?name=missing")).toEqual({
      error: "map 'missing' does not exist.",
    });
    expect(await json(server, "/api/map")).toEqual({
      error: "map context is required; pass --map or set WAYFUL_MAP.",
    });

    await writeFile(join(project, ".wayful", "maps", "plan", "map.toml"), "not toml = [");
    expect((await json(server, "/api/map?name=plan")).error).toContain("malformed TOML");
  });

  test("step resolves by name or ID and carries the body plus live type instructions", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    const byId = await json(server, "/api/step?map=plan&ref=1");
    expect(byId.name).toBe("work");
    expect(byId.body).toBe("Step narrative.\n");
    expect(byId.instructions).toBe("Use primary sources.\n");
    expect((await json(server, "/api/step?map=plan&ref=work")).id).toBe(1);
    expect(await json(server, "/api/step?map=plan&ref=99")).toEqual({
      error: "step '99' does not exist.",
    });
  });

  test("events opens an SSE stream that greets and then reports .wayful changes", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    const response = await get(server, "/api/events");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe("data: hello\n\n");

    // One edit can raise several filesystem events; the stream only ever says
    // that something changed, so the client's response to one or five is the same.
    //
    // The backend establishes its watcher asynchronously, so a write made
    // before the watcher exists is missed. Keep touching the tree until the
    // stream reports the change — what an editor's repeated saves would do —
    // rather than assuming the very first write is observed. Racing one
    // persistent read against a short timer means no read is left dangling.
    const read = reader.read();
    let changed = "";
    for (let index = 0; index < 100 && changed === ""; index++) {
      await writeFile(
        join(project, ".wayful", "maps", "plan", `touched-${index}.txt`),
        "changed",
      ).catch(() => {});
      const result = await Promise.race([
        read,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50)),
      ]);
      if (result !== undefined && !result.done) changed = decoder.decode(result.value);
    }
    expect(changed).toContain("data: changed\n\n");

    await reader.cancel();
  }, 15_000);

  test("unknown API routes are 404 rather than an SPA fallback", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    expect((await get(server, "/api/nope")).status).toBe(404);
  });
});

describe("project resolution", () => {
  test("serves the project named by --project rather than the working directory", async () => {
    const project = await projectFixture();
    const elsewhere = await temporaryDirectory();
    const server = await serve({ project });

    expect(server.root).toBe(project);
    expect((await json(server, "/api/overview")).project.root).toBe(project);
    expect(elsewhere).not.toBe(project);
  });

  test("discovers the enclosing project from a nested directory", async () => {
    const project = await projectFixture();
    const nested = join(project, "a", "deep", "directory");
    await mkdir(nested, { recursive: true });

    const server = await serve({ project: nested });

    expect(server.root).toBe(project);
    expect((await json(server, "/api/overview")).project.root).toBe(project);
  });

  test("still starts where there is no project, reporting the absence in the payload", async () => {
    const empty = await temporaryDirectory();

    const server = await serve({ project: empty });

    expect(server.found).toBe(false);
    const overview = await json(server, "/api/overview");
    expect(overview.project.root).toBe(empty);
    expect(overview.project.error).toContain("no Wayful project found");
    expect(overview.maps).toEqual([]);
    expect(overview.types).toEqual([]);
  });
});

describe("serving the viewer client", () => {
  test("without a client, only the API is served", async () => {
    const project = await projectFixture();
    const server = await serve({ project });

    expect((await get(server, "/")).status).toBe(404);
    expect((await get(server, "/maps/plan")).status).toBe(404);
    expect((await get(server, "/api/overview")).status).toBe(200);
  });

  test("with a client, assets are served and deep links fall back to the SPA shell", async () => {
    const project = await projectFixture();
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "assets"), { recursive: true });
    const indexPath = join(directory, "index.html");
    const assetPath = join(directory, "assets", "index-abc.js");
    await writeFile(indexPath, '<!doctype html><div id="root"></div>');
    await writeFile(assetPath, "export const ok = 1;\n");
    const client = { "/": indexPath, "/index.html": indexPath, "/assets/index-abc.js": assetPath };
    const server = await serve({ project, client });

    const shell = await get(server, "/");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('id="root"');

    const deepLink = await get(server, "/maps/plan");
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain('id="root"');

    const asset = await get(server, "/assets/index-abc.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("export const ok = 1;\n");

    // The API must keep winning over the SPA fallback.
    expect((await get(server, "/api/nope")).status).toBe(404);
    expect((await get(server, "/api/overview")).status).toBe(200);
  });

  test("a path matching no asset gets the SPA shell rather than a 404", async () => {
    const project = await projectFixture();
    const directory = await temporaryDirectory();
    const indexPath = join(directory, "index.html");
    await writeFile(indexPath, '<!doctype html><div id="root"></div>');
    const client = { "/": indexPath, "/index.html": indexPath };
    const server = await serve({ project, client });

    // A request path is only ever compared against map keys — there is no
    // filesystem path underneath it left to escape into — so an escape
    // attempt just misses the map like any other unknown route.
    const escaped = await get(server, "/%2e%2e/secret.txt");
    expect(escaped.status).toBe(200);
    expect(await escaped.text()).toContain('id="root"');
  });
});

describe("resolving client assets to serve", () => {
  // A prior local `bun run build` regenerates `embedded-ui.ts` in place with
  // real content, which then always wins over `WAYFUL_UI_DIST` below — by
  // design, matching what a compiled binary does. That only ever happens
  // outside CI, where `check` always runs against the checked-in empty
  // placeholder, so the directory-walk path is asserted only then.
  const embedded = Object.keys(EMBEDDED_ASSETS).length > 0;

  test.skipIf(embedded)(
    "walks the resolved client directory into a route map, keyed with a leading slash",
    async () => {
      const directory = await temporaryDirectory();
      await mkdir(join(directory, "assets"), { recursive: true });
      await writeFile(join(directory, "index.html"), "<!doctype html>");
      await writeFile(join(directory, "assets", "index-abc.js"), "export const ok = 1;\n");

      const resolved = resolveClientAssets({ WAYFUL_UI_DIST: directory });

      expect(resolved?.description).toBe(directory);
      expect(Object.keys(resolved?.assets ?? {}).toSorted()).toEqual([
        "/",
        "/assets/index-abc.js",
        "/index.html",
      ]);
      expect(resolved?.assets["/"]).toBe(resolved?.assets["/index.html"]);
    },
  );

  test.skipIf(!embedded)("prefers the embedded client over any directory candidate", () => {
    const resolved = resolveClientAssets({ WAYFUL_UI_DIST: "/nonexistent" });

    expect(resolved?.description).toBe("(embedded)");
    expect(resolved?.assets).toBe(EMBEDDED_ASSETS);
  });
});

describe("locating the bundled client", () => {
  test("prefers an explicit WAYFUL_UI_DIST over the bundled and workspace copies", async () => {
    const client = await temporaryDirectory();
    await writeFile(join(client, "index.html"), "<!doctype html>");

    expect(clientDirectory({ WAYFUL_UI_DIST: client })).toBe(client);
  });

  test("falls past a candidate that holds no built client", async () => {
    const empty = await temporaryDirectory();

    expect(clientDirectory({ WAYFUL_UI_DIST: empty })).not.toBe(empty);
  });
});
