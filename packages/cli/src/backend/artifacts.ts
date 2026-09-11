import { Effect } from "effect";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { classifyRef, normalizeRef } from "../domain/artifact-ref";
import { WayfulError } from "../domain/errors";
import type { ArtifactContent, MapSnapshot } from "../domain/model";
import { liftSync } from "./effect";
import type { MapHandle } from "./MapStore";

/** Reads are capped rather than streamed; the response reports the cut with `truncated`. */
export const MAX_ARTIFACT_BYTES = 1024 * 1024;

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

const fail = (message: string) => Effect.fail(new WayfulError({ message }));

/**
 * Re-checks the ADR-0002 syntax layers on a canonical ref before it reaches
 * the filesystem — `..` segments, control characters, a non-`file:` scheme and
 * a non-markdown extension are all refused here rather than trusted from what
 * was stored. Returns the project-relative path for an accepted ref.
 */
function readablePath(canonicalRef: string): string {
  const ref = classifyRef(canonicalRef);
  if (ref.kind !== "file")
    throw new WayfulError({
      message: `artifact '${canonicalRef}' is not readable; only file: refs are dereferenced.`,
    });
  const target = ref.path;
  if (target.split("/").some((segment) => segment === ".."))
    throw new WayfulError({
      message: `artifact '${canonicalRef}' is not readable; file: refs may not contain '..' segments.`,
    });
  if ([...target].some((character) => character.codePointAt(0)! < 0x20 || character === "\u007f"))
    throw new WayfulError({
      message: `artifact '${canonicalRef}' is not readable; file: refs may not contain control characters.`,
    });
  if (!MARKDOWN_EXTENSIONS.some((extension) => target.toLowerCase().endsWith(extension)))
    throw new WayfulError({
      message: `artifact '${canonicalRef}' is not readable; only .md and .markdown files are dereferenced.`,
    });
  return target;
}

/**
 * Reads a canonical `file:` ref against the project root, enforcing ADR-0002's
 * containment layers: `realpath` the root, `realpath` the target, re-assert
 * containment so a symlink out of the project fails closed, then require a
 * regular file. A missing checkout (or a ref pointing at a file that was never
 * written) is a clear operational error, never a crash.
 */
export function readLocalArtifact(
  projectRoot: string,
  canonicalRef: string,
): Effect.Effect<ArtifactContent, WayfulError> {
  return Effect.tryPromise({
    try: async (): Promise<ArtifactContent> => {
      const relativePath = readablePath(canonicalRef);
      let root: string;
      try {
        root = await realpath(projectRoot);
      } catch {
        throw new WayfulError({
          message: `artifact '${canonicalRef}' is not readable: project root '${projectRoot}' cannot be resolved.`,
        });
      }
      let target: string;
      try {
        target = await realpath(join(root, relativePath));
      } catch {
        throw new WayfulError({
          message: `artifact '${canonicalRef}' is not readable: no file at '${relativePath}' (is the project checked out locally?).`,
        });
      }
      const contained = relative(root, target);
      if (
        contained === "" ||
        contained === ".." ||
        contained.startsWith(`..${sep}`) ||
        isAbsolute(contained)
      )
        throw new WayfulError({
          message: `artifact '${canonicalRef}' is not readable: it resolves outside the project root.`,
        });
      const info = await stat(target);
      if (!info.isFile())
        throw new WayfulError({
          message: `artifact '${canonicalRef}' is not readable: it is not a regular file.`,
        });
      // Read at most one byte past the cap so an oversized file is bounded in
      // memory rather than buffered whole and then sliced.
      const handle = await open(target, "r");
      let bytesRead = 0;
      let buffer: Buffer;
      try {
        buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
        ({ bytesRead } = await handle.read(buffer, 0, MAX_ARTIFACT_BYTES + 1, 0));
      } finally {
        await handle.close();
      }
      const truncated = bytesRead > MAX_ARTIFACT_BYTES;
      return {
        ref: canonicalRef,
        format: "markdown",
        content: new TextDecoder().decode(
          buffer.subarray(0, Math.min(bytesRead, MAX_ARTIFACT_BYTES)),
        ),
        truncated,
      };
    },
    catch: (error) =>
      error instanceof WayfulError
        ? error
        : new WayfulError({
            message: `artifact '${canonicalRef}' is not readable (${String(error)}).`,
          }),
  });
}

/**
 * The readable set is closed: only a ref attached on the map may be
 * dereferenced. Membership is checked against the map's derived artifacts, so
 * an orphaned path is never readable — then resolution is local in every
 * backend (ADR-0002), over records that may have come from the network.
 */
export function makeReadArtifact(deps: {
  readonly snapshot: (
    map: MapHandle,
  ) => Effect.Effect<{ readonly snapshot: MapSnapshot }, WayfulError>;
}) {
  return (map: MapHandle, ref: string): Effect.Effect<ArtifactContent, WayfulError> =>
    Effect.gen(function* () {
      const canonical = yield* liftSync(() => normalizeRef(ref));
      const { snapshot } = yield* deps.snapshot(map);
      if (!snapshot.artifacts.some((artifact) => artifact.ref === canonical))
        return yield* fail(`artifact '${canonical}' is not attached on map '${map.name}'.`);
      return yield* readLocalArtifact(map.project.root, canonical);
    });
}
