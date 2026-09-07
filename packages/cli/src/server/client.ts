// Where the built viewer client lives. `wayful ui` must work from any working
// directory and without the `packages/ui` workspace present, so the client is
// looked up by candidate rather than by a relative path from the caller.

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { EMBEDDED_ASSETS } from "./embedded-ui";

/** `packages/cli`, from `packages/cli/src/server/client.ts`. */
const PACKAGE_ROOT = resolve(import.meta.dir, "..", "..");

/** Where `bun run --filter '@wayful/cli' build` puts the bundled client. */
export const BUNDLED_CLIENT = join(PACKAGE_ROOT, "dist", "ui");

/** Where `bun run --filter '@wayful/ui' build` puts it inside this workspace. */
const WORKSPACE_CLIENT = join(PACKAGE_ROOT, "..", "ui", "dist");

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
): string | undefined {
  const candidates = [environment.WAYFUL_UI_DIST, BUNDLED_CLIENT, WORKSPACE_CLIENT];
  return candidates.find(
    (candidate): candidate is string => !!candidate && existsSync(join(candidate, "index.html")),
  );
}

/** Recursively maps every file under `directory` to a route, `/` included. */
function walkAssets(directory: string): Record<string, string> {
  const assets: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}/${entry.name}`);
      else assets[`${prefix}/${entry.name}`] = path;
    }
  };
  walk(directory, "");
  if (assets["/index.html"]) assets["/"] = assets["/index.html"];
  return assets;
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
): { assets: Record<string, string>; description: string } | undefined {
  if (Object.keys(EMBEDDED_ASSETS).length > 0) {
    return { assets: EMBEDDED_ASSETS, description: "(embedded)" };
  }
  const directory = clientDirectory(environment);
  return directory ? { assets: walkAssets(directory), description: directory } : undefined;
}
