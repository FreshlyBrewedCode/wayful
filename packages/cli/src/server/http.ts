// The HTTP surface: the viewer's JSON API, a change-notification stream, and —
// when a built client is supplied — the viewer SPA itself. Nothing here writes
// to `.wayful`; the server only ever reads through the backend.

import { Effect, Option, Result } from "effect";
import { resolve } from "node:path";

import { MapStore } from "../backend/MapStore";
import type { ProjectStore } from "../backend/ProjectStore";
import { resolveProject } from "../scope";
import { WayfulError } from "../domain/errors";
import { mapDetail, overview, stepDetail } from "./api";

export interface ServerConfig {
  /** Project directory hint; the enclosing project is discovered upward from it. */
  readonly project: string;
  readonly host: string;
  /** `0` binds an ephemeral port, which `RunningServer.port` then reports. */
  readonly port: number;
  /**
   * A built viewer client to serve, as a route → file-path map, or `undefined`
   * to expose only the API. Built once by `resolveClientAssets` before the
   * server starts, so a request path is only ever compared against map keys —
   * never turned into a filesystem path itself.
   */
  readonly client: Record<string, string> | undefined;
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

/** A malformed escape matches no map key, so it falls back to the shell. */
function decodeSafely(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

/**
 * Serves a built asset, falling back to the SPA shell so a deep link like
 * `/maps/plan` reaches the client router instead of a 404. A request path is
 * only ever looked up as a map key — never resolved against a directory — so
 * there is no filesystem path for it to escape into in the first place.
 */
async function asset(assets: Record<string, string>, pathname: string): Promise<Response> {
  const requested = decodeSafely(pathname);
  const matched = assets[requested === "/" ? "/index.html" : requested];
  if (matched) {
    const file = Bun.file(matched);
    if (await file.exists()) return new Response(file);
  }
  const shellPath = assets["/index.html"];
  const shell = shellPath ? Bun.file(shellPath) : undefined;
  if (shell && (await shell.exists()))
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
): Effect.Effect<RunningServer, WayfulError, MapStore | ProjectStore> {
  return Effect.gen(function* () {
    const services = yield* Effect.context<MapStore | ProjectStore>();
    const run = <A>(effect: Effect.Effect<A, never, MapStore | ProjectStore>) =>
      Effect.runPromiseWith(services)(effect);

    const hint = resolve(config.project);
    const opened = yield* Effect.result(resolveProject(Option.some(hint)));
    const root = Result.isSuccess(opened) ? opened.success.root : hint;

    // Clients hold one stream each and are told to refetch on any change; the
    // server never says what changed, only that something did. How a backend
    // learns of a change is its own concern — a filesystem watcher on `.wayful`
    // or conditional-request polling against GitHub — so the server only
    // subscribes and stops it. Watching is a convenience; the viewer still
    // works without it, so a subscription that cannot start is a no-op.
    const listeners = new Set<(event: string) => void>();
    const emitChanged = () => {
      for (const send of listeners) send("changed");
    };
    const mapStore = yield* MapStore;
    const stopWatching = Result.isSuccess(opened)
      ? yield* mapStore
          .watch(opened.success, emitChanged)
          .pipe(Effect.orElseSucceed(() => () => {}))
      : () => {};

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
    }).pipe(Effect.tapError(() => Effect.sync(() => stopWatching())));

    return {
      url: `http://${config.host}:${server.port ?? config.port}/`,
      port: server.port ?? config.port,
      root,
      found: Result.isSuccess(opened),
      stop: () => {
        stopWatching();
        listeners.clear();
        server.stop(true);
      },
    };
  });
}
