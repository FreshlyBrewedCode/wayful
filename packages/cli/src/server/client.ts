// Where the built viewer client lives. `wayful ui` must work from any working
// directory and without the `packages/ui` workspace present, so the client is
// looked up by candidate rather than by a relative path from the caller.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

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
