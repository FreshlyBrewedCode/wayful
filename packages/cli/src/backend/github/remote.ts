import { Effect, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface GitRemoteRef {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

// `git@host:owner/repo.git` — the scp-like shorthand SSH accepts, and the
// form `git remote get-url` echoes back for an `ssh://`-less SSH remote.
const SSH_SCP_LIKE = /^(?:[^@/\s]+@)?([^/\s:]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
// `ssh://[user@]host[:port]/owner/repo[.git]` or `http(s)://[user@]host[:port]/owner/repo[.git]`.
const URL_LIKE =
  /^(?:https?|ssh):\/\/(?:[^@/\s]+@)?([^/\s:]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** Parses a git remote URL's host/owner/repo; pure, no I/O. */
export function parseGitRemoteUrl(url: string): Option.Option<GitRemoteRef> {
  const trimmed = url.trim();
  const match = URL_LIKE.exec(trimmed) ?? SSH_SCP_LIKE.exec(trimmed);
  if (!match) return Option.none();
  const [, host, owner, repo] = match;
  return Option.some({ host: host!, owner: owner!, repo: repo! });
}

/**
 * Resolves and parses the `origin` remote's URL via `git remote get-url
 * origin`, the one shell-out this needs — `.git/config` isn't parsed
 * directly since remote URL rewriting (`insteadOf`, worktree-local
 * overrides) only git itself resolves correctly. Absent a usable origin (no
 * remote, not a git repository, git unavailable, or an unparseable URL)
 * resolves to `None` rather than failing, so a caller can fall back to an
 * explicit `--repo` flag.
 */
export function resolveOriginRemote(): Effect.Effect<
  Option.Option<GitRemoteRef>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = yield* spawner
      .string(ChildProcess.make("git", ["remote", "get-url", "origin"]))
      .pipe(Effect.orElseSucceed(() => ""));
    const url = output.trim();
    return url ? parseGitRemoteUrl(url) : Option.none();
  });
}
