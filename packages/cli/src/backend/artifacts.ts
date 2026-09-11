import { Effect, FileSystem, Option, Path } from "effect";

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
 * written) is a clear operational error, never a crash. `realPath`/`stat`
 * follow symlinks the same way `node:fs/promises`' `realpath`/`stat` did, so
 * the containment semantics above are unchanged.
 */
export function readLocalArtifact(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectRoot: string,
  canonicalRef: string,
): Effect.Effect<ArtifactContent, WayfulError> {
  return Effect.gen(function* () {
    const relativePath = yield* liftSync(() => readablePath(canonicalRef));
    const root = yield* fs.realPath(projectRoot).pipe(
      Effect.mapError(
        () =>
          new WayfulError({
            message: `artifact '${canonicalRef}' is not readable: project root '${projectRoot}' cannot be resolved.`,
          }),
      ),
    );
    const target = yield* fs.realPath(path.join(root, relativePath)).pipe(
      Effect.mapError(
        () =>
          new WayfulError({
            message: `artifact '${canonicalRef}' is not readable: no file at '${relativePath}' (is the project checked out locally?).`,
          }),
      ),
    );
    const contained = path.relative(root, target);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${path.sep}`) ||
      path.isAbsolute(contained)
    )
      yield* fail(
        `artifact '${canonicalRef}' is not readable: it resolves outside the project root.`,
      );
    const notAFile = () =>
      new WayfulError({
        message: `artifact '${canonicalRef}' is not readable: it is not a regular file.`,
      });
    const info = yield* fs.stat(target).pipe(Effect.mapError(notAFile));
    if (info.type !== "File") yield* Effect.fail(notAFile());
    // Read at most one byte past the cap so an oversized file is bounded in
    // memory rather than buffered whole and then sliced.
    const bytes = yield* Effect.scoped(
      fs.open(target).pipe(Effect.flatMap((file) => file.readAlloc(MAX_ARTIFACT_BYTES + 1))),
    ).pipe(
      Effect.mapError(
        (error) =>
          new WayfulError({
            message: `artifact '${canonicalRef}' is not readable (${String(error)}).`,
          }),
      ),
    );
    // `readAlloc` reports a zero-byte read as `None` rather than an empty
    // buffer; either way there is nothing past the header to decode.
    const truncated = Option.isSome(bytes) && bytes.value.length > MAX_ARTIFACT_BYTES;
    const content = Option.match(bytes, {
      onNone: () => "",
      onSome: (buffer) =>
        new TextDecoder().decode(buffer.subarray(0, Math.min(buffer.length, MAX_ARTIFACT_BYTES))),
    });
    return { ref: canonicalRef, format: "markdown", content, truncated } satisfies ArtifactContent;
  });
}

/**
 * The readable set is closed: only a ref attached on the map may be
 * dereferenced. Membership is checked against the map's derived artifacts, so
 * an orphaned path is never readable — then resolution is local in every
 * backend (ADR-0002), over records that may have come from the network.
 */
export function makeReadArtifact(deps: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
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
      return yield* readLocalArtifact(deps.fs, deps.path, map.project.root, canonical);
    });
}
