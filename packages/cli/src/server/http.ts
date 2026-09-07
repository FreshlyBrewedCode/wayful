// The HTTP surface: the viewer's JSON API, a change-notification stream, and —
// when a built client is supplied — the viewer SPA itself. Nothing here writes
// to `.wayful`; the server only ever reads through the backend.

import { Effect, Option, Result } from "effect";
import { watch, type FSWatcher } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { WayfulBackend } from "../backend/Backend";
import { resolveProject } from "../context";
import { WayfulError } from "../domain/errors";
import { mapDetail, overview, stepDetail } from "./api";

export interface ServerConfig {
  /** Project directory hint; the enclosing project is discovered upward from it. */
  readonly project: string;
  readonly host: string;
  /** `0` binds an ephemeral port, which `RunningServer.port` then reports. */
  readonly port: number;
  /** A built viewer client to serve, or `undefined` to expose only the API. */
  readonly client: string | undefined;
}

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  /** The resolved project root, or the hint itself when no project was found. */
  readonly root: string;
  readonly found: boolean;
  readonly stop: () => void;
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const notFound = () => new Response("not found", { status: 404 });

/** A malformed escape is a path no asset can have, so it falls back to the shell. */
function decodeSafely(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

/**
 * Serves a built asset, falling back to the SPA shell so a deep link like
 * `/maps/plan` reaches the client router instead of a 404. Paths that resolve
 * outside the client directory get the shell too, never the file they asked
 * for — the server hands out the viewer, not the filesystem.
 */
async function asset(client: string, pathname: string): Promise<Response> {
  // Decoded before resolving, so an escape encoded as `%2e%2e` is caught by the
  // containment check rather than served as a literal directory name.
  const requested = decodeSafely(pathname);
  const target = resolve(client, requested === "/" ? "index.html" : requested.replace(/^\/+/, ""));
  if (target.startsWith(client + sep)) {
    const file = Bun.file(target);
    if (await file.exists()) return new Response(file);
  }
  const shell = Bun.file(join(client, "index.html"));
  if (await shell.exists())
    return new Response(shell, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  return new Response("no client build found; run `bun run build` in packages/cli", {
    status: 404,
  });
}

/**
 * Starts the server and returns a handle that reports the port actually bound
 * and the project actually resolved — the two things a caller cannot know from
 * the config alone.
 */
export function startServer(
  config: ServerConfig,
): Effect.Effect<RunningServer, WayfulError, WayfulBackend> {
  return Effect.gen(function* () {
    const services = yield* Effect.context<WayfulBackend>();
    const run = <A>(effect: Effect.Effect<A, never, WayfulBackend>) =>
      Effect.runPromiseWith(services)(effect);

    const hint = resolve(config.project);
    const opened = yield* Effect.result(resolveProject(Option.some(hint)));
    const root = Result.isSuccess(opened) ? opened.success.root : hint;

    // Clients hold one stream each and are told to refetch on any `.wayful`
    // change; the server never says what changed, only that something did.
    const listeners = new Set<(event: string) => void>();
    let watcher: FSWatcher | undefined;
    try {
      watcher = watch(join(root, ".wayful"), { recursive: true }, () => {
        for (const send of listeners) send("changed");
      });
    } catch {
      // Watching is a convenience; the viewer still works without it.
    }

    function events(): Response {
      let send: (event: string) => void;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          send = (event) => controller.enqueue(encoder.encode(`data: ${event}\n\n`));
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

    async function handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const parameter = (name: string) => url.searchParams.get(name) ?? "";
      switch (url.pathname) {
        case "/api/overview":
          return json(await run(overview(hint)));
        case "/api/map":
          return json(await run(mapDetail(hint, parameter("name"))));
        case "/api/step":
          return json(await run(stepDetail(hint, parameter("map"), parameter("ref"))));
        case "/api/events":
          return events();
        default:
          if (url.pathname.startsWith("/api/")) return notFound();
          return config.client ? asset(config.client, url.pathname) : notFound();
      }
    }

    const server = yield* Effect.try({
      try: () =>
        Bun.serve({
          port: config.port,
          hostname: config.host,
          idleTimeout: 240,
          fetch: handle,
        }),
      catch: (cause) =>
        new WayfulError({
          message: `cannot listen on ${config.host}:${config.port} (${String(cause)}).`,
        }),
    }).pipe(Effect.tapError(() => Effect.sync(() => watcher?.close())));

    return {
      url: `http://${config.host}:${server.port ?? config.port}/`,
      port: server.port ?? config.port,
      root,
      found: Result.isSuccess(opened),
      stop: () => {
        watcher?.close();
        listeners.clear();
        server.stop(true);
      },
    };
  });
}
