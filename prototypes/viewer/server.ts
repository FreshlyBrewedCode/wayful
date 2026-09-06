// PROTOTYPE — throwaway. A read-only viewer for Wayful projects.
//
//   bun server.ts [--project DIR] [--port N] [--host ADDR]
//
// It owns no domain logic. Every number on screen comes from the Wayful CLI's
// own `--json` output, so the viewer cannot disagree with `wayful` about the
// state of a map. Nothing is written; `.wayful` is only ever read.

import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(Bun.fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli", "src", "main.ts");

const argv = Bun.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PROJECT = resolve(arg("project", join(HERE, "demo-project")));
const PORT = Number(arg("port", "7830"));
const HOST = arg("host", "0.0.0.0");

// --------------------------------------------------------------- CLI bridge

type CliResult = { ok: boolean; code: number; data: any; stderr: string };

// Map context is always passed explicitly, so WAYFUL_MAP is cleared to keep an
// ambient shell value from selecting a different map than the one requested.
const { WAYFUL_MAP: _ignored, ...baseEnv } = process.env;

async function wayful(args: string[]): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--json"], {
    env: { ...baseEnv, WAYFUL_PROJECT: PROJECT },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let data: any = null;
  try {
    data = stdout.trim() ? JSON.parse(stdout) : null;
  } catch {
    data = null;
  }
  // `map validate` exits 1 for an invalid map. That is a finding, not a failure.
  return { ok: code === 0 || data !== null, code, data, stderr: stderr.trim() };
}

async function projectMeta() {
  try {
    const text = await readFile(join(PROJECT, ".wayful", "project.toml"), "utf8");
    const data = Bun.TOML.parse(text) as any;
    return { root: PROJECT, description: data?.description ?? "" };
  } catch {
    return { root: PROJECT, description: "", error: "no Wayful project found here" };
  }
}

async function overview() {
  const [meta, maps, types] = await Promise.all([
    projectMeta(),
    wayful(["map", "list"]),
    wayful(["type", "list"]),
  ]);
  const statuses = await Promise.all(
    (maps.data ?? []).map((m: any) => wayful(["map", "status", "--map", m.name])),
  );
  return {
    project: meta,
    maps: (maps.data ?? []).map((m: any, i: number) => ({
      ...m,
      status: statuses[i].data,
    })),
    types: types.data ?? [],
    error: maps.data ? undefined : maps.stderr,
  };
}

async function mapDetail(name: string) {
  const [show, status, next, validation] = await Promise.all([
    wayful(["map", "show", "--map", name]),
    wayful(["map", "status", "--map", name]),
    wayful(["map", "next", "--map", name]),
    wayful(["map", "validate", "--map", name]),
  ]);
  if (!show.data) return { error: show.stderr || `cannot read map '${name}'` };
  return {
    map: show.data,
    status: status.data,
    next: (next.data ?? []).map((s: any) => s.id),
    validation: validation.data,
  };
}

// ----------------------------------------------------------- change signals

const listeners = new Set<(event: string) => void>();
try {
  watch(join(PROJECT, ".wayful"), { recursive: true }, () => {
    for (const send of listeners) send("changed");
  });
} catch {
  // Watching is a convenience; the viewer still works without it.
}

// ------------------------------------------------------------------- server

const asset = async (name: string, type: string) =>
  new Response(await readFile(join(HERE, name)), {
    headers: { "content-type": type, "cache-control": "no-store" },
  });

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/":
        return asset("index.html", "text/html; charset=utf-8");
      case "/app.css":
        return asset("app.css", "text/css; charset=utf-8");
      case "/app.js":
        return asset("app.js", "text/javascript; charset=utf-8");
      case "/api/overview":
        return json(await overview());
      case "/api/map":
        return json(await mapDetail(url.searchParams.get("name") ?? ""));
      case "/api/step": {
        const result = await wayful([
          "step",
          "show",
          url.searchParams.get("ref") ?? "",
          "--map",
          url.searchParams.get("map") ?? "",
        ]);
        return json(result.data ?? { error: result.stderr });
      }
      case "/api/events": {
        let send: (event: string) => void;
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            send = (event) =>
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            send("hello");
            listeners.add(send);
          },
          cancel() {
            listeners.delete(send);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

console.log(`wayful viewer (prototype)
  project : ${PROJECT}
  local   : http://localhost:${server.port}/`);
