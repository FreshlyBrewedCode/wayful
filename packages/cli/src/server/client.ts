// Where the built viewer client lives. `wayful ui` must work from any working
// directory and without the `packages/ui` workspace present, so the client is
// looked up by candidate rather than by a relative path from the caller.

import { Effect, FileSystem, Path } from "effect";

import { EMBEDDED_ASSETS } from "@server/embedded-ui";

/** `packages/cli`, from `packages/cli/src/server/client.ts`. */
const packageRoot = (path: Path.Path) => path.resolve(import.meta.dir, "..", "..");

/**
 * The first candidate that actually holds a built client, or `undefined` when
 * none does — in which case `wayful ui` tells the caller to build rather than
 * serving a directory of 404s.
 *
 * `WAYFUL_UI_DIST` wins, so a client built anywhere can be pointed at without
 * reinstalling; the bundled copy beats the workspace one, so an installed CLI
 * never quietly serves a stale sibling checkout.
 */
export function clientDirectory(
  environment: Record<string, string | undefined> = process.env,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = packageRoot(path);
    const candidates = [
      environment.WAYFUL_UI_DIST,
      path.join(root, "dist", "ui"),
      path.join(root, "..", "ui", "dist"),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const present = yield* fs
        .exists(path.join(candidate, "index.html"))
        .pipe(Effect.orElseSucceed(() => false));
      if (present) return candidate;
    }
    return undefined;
  });
}

/** Recursively maps every file under `directory` to a route, `/` included. */
function walkAssets(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
): Effect.Effect<Record<string, string>, never> {
  return Effect.gen(function* () {
    const assets: Record<string, string> = {};
    const walk = (current: string, prefix: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const entries = yield* fs
          .readDirectory(current)
          .pipe(Effect.orElseSucceed(() => [] as Array<string>));
        for (const entry of entries) {
          const entryPath = path.join(current, entry);
          const info = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => undefined));
          if (info?.type === "Directory") yield* walk(entryPath, `${prefix}/${entry}`);
          else assets[`${prefix}/${entry}`] = entryPath;
        }
      });
    yield* walk(directory, "");
    if (assets["/index.html"]) assets["/"] = assets["/index.html"];
    return assets;
  });
}

/**
 * The route → file-path map `startServer` looks requests up in. A compiled
 * binary carries `EMBEDDED_ASSETS` — populated by `bun run build`'s codegen —
 * so that wins first; otherwise this falls back to walking whatever
 * `clientDirectory` finds, which is what makes `bun packages/cli/src/main.ts
 * ui` work from an unbuilt checkout with `WAYFUL_UI_DIST` or a workspace
 * `packages/ui/dist` build.
 */
export function resolveClientAssets(
  environment: Record<string, string | undefined> = process.env,
): Effect.Effect<
  { assets: Record<string, string>; description: string } | undefined,
  never,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    if (Object.keys(EMBEDDED_ASSETS).length > 0) {
      return { assets: EMBEDDED_ASSETS, description: "(embedded)" };
    }
    const directory = yield* clientDirectory(environment);
    if (!directory) return undefined;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return { assets: yield* walkAssets(fs, path, directory), description: directory };
  });
}
