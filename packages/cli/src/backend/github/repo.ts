import { Effect, Option, type Redacted } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "@domain/errors";
import type { ProjectHandle } from "@backend/ProjectStore";
import type { GithubCredentials } from "@backend/github/credentials";
import { resolveOriginRemote, type GitRemoteRef } from "@backend/github/remote";

export interface ResolvedRepo {
  readonly ref: GitRemoteRef;
  readonly token: Redacted.Redacted<string>;
}

/**
 * The host a github-backed project addresses. The host recorded at init always
 * wins; a project that predates the key falls back to the git remote resolved
 * in the *project root* — never the invocation directory — and finally to
 * `github.com`. Resolving in the project root is what lets `--project` target
 * a project from an unrelated checkout: the host travels with the project.
 */
export function resolveRepoRef(
  project: ProjectHandle,
): Effect.Effect<GitRemoteRef, WayfulError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    if (project.backend !== "github" || project.repo === undefined)
      return yield* new WayfulError({
        message: "project is not configured for the github backend.",
      });
    const [owner, repo] = project.repo.split("/");
    let host = project.host;
    if (host === undefined) {
      const remote = yield* resolveOriginRemote(project.root);
      host = Option.match(remote, { onNone: () => "github.com", onSome: (r) => r.host });
    }
    return { host, owner: owner!, repo: repo! };
  });
}

/**
 * The repo a github-backed project addresses, plus the token that may write to
 * it. The host is `resolveRepoRef`'s, so an enterprise project resolves its own
 * API base; the token then resolves against that host.
 */
export function resolveRepo(
  project: ProjectHandle,
  credentials: GithubCredentials["Service"],
): Effect.Effect<ResolvedRepo, WayfulError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const ref = yield* resolveRepoRef(project);
    const token = yield* credentials.token(ref.host);
    return { ref, token };
  });
}
