import { join } from "node:path";

import { Context, Effect, FileSystem, Layer, Option, Path } from "effect";

/**
 * One conditional `GET`'s revalidation material: the `ETag` GitHub returned,
 * the parsed body it guards, and the response headers the body was read with.
 */
export interface CachedGet {
  readonly etag: string;
  readonly value: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Where conditional `GET` responses are cached. Every cache is always
 * revalidated with `If-None-Match`, so a hit never serves stale data — it only
 * saves re-downloading and re-parsing a body that has not changed. The
 * in-memory implementation keeps one process's reuse; the disk implementation
 * lets a fresh process (the CLI, invoked once per command) reuse it too.
 */
export class GithubCache extends Context.Service<
  GithubCache,
  {
    readonly read: (url: string) => Effect.Effect<Option.Option<CachedGet>>;
    readonly write: (url: string, entry: CachedGet) => Effect.Effect<void>;
  }
>()("wayful/GithubCache") {}

/** A per-process cache; the fallback when no cache directory is configured. */
export const GithubMemoryCache = Layer.sync(GithubCache, () => {
  const entries = new Map<string, CachedGet>();
  return GithubCache.of({
    read: (url) => Effect.sync(() => Option.fromNullishOr(entries.get(url))),
    write: (url, entry) =>
      Effect.sync(() => {
        entries.set(url, entry);
      }),
  });
});

/** The on-disk cache directory, overridable for tests and unusual homes. */
export function githubCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CACHE_HOME ?? join(env.HOME ?? "/tmp", ".cache");
  return join(root, "wayful", "github");
}

function cacheFile(path: Path.Path, directory: string, url: string): string {
  return path.join(directory, `${encodeURIComponent(url)}.json`);
}

/**
 * A cache that outlives the process: entries are written as JSON under
 * `directory` and read back by a later invocation. Reads never trust the file
 * without conditional revalidation — `GithubHttp` always sends
 * `If-None-Match` — so a stale entry can only cost a `304`, never a wrong
 * answer. Every disk failure is a miss; a cache is never allowed to fail a
 * request.
 */
export const GithubDiskCache = (directory: string) =>
  Layer.effect(
    GithubCache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const memory = new Map<string, CachedGet>();
      return GithubCache.of({
        read: (url) =>
          Effect.gen(function* () {
            const cached = memory.get(url);
            if (cached !== undefined) return Option.some(cached);
            const text = yield* fs
              .readFileString(cacheFile(path, directory, url))
              .pipe(Effect.orElseSucceed(() => undefined));
            if (text === undefined) return Option.none<CachedGet>();
            const parsed = yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
              Effect.orElseSucceed(() => undefined),
            );
            if (parsed === null || parsed === undefined || typeof parsed !== "object")
              return Option.none<CachedGet>();
            const entry = parsed as CachedGet;
            memory.set(url, entry);
            return Option.some(entry);
          }),
        write: (url, entry) =>
          Effect.gen(function* () {
            memory.set(url, entry);
            yield* fs
              .makeDirectory(directory, { recursive: true })
              .pipe(
                Effect.andThen(
                  fs.writeFileString(cacheFile(path, directory, url), JSON.stringify(entry)),
                ),
                Effect.ignore,
              );
          }),
      });
    }),
  );
