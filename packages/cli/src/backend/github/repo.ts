import { Effect, Option, type Redacted } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "../../domain/errors";
import type { ProjectHandle } from "../ProjectStore";
import type { GithubCredentials } from "./credentials";
import { resolveOriginRemote, type GitRemoteRef } from "./remote";

export interface ResolvedRepo {
  readonly ref: GitRemoteRef;
  readonly token: Redacted.Redacted<string>;
}

/**
 * The repo a github-backed project addresses, plus the token that may write to
 * it. The host comes from the git remote (defaulting to `github.com`), so an
 * enterprise checkout resolves its own API base; the token then resolves
 * against that host.
 */
export function resolveRepo(
  project: ProjectHandle,
  credentials: GithubCredentials["Service"],
): Effect.Effect<ResolvedRepo, WayfulError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    if (project.backend !== "github" || project.repo === undefined)
      return yield* Effect.fail(
        new WayfulError({ message: "project is not configured for the github backend." }),
      );
    const [owner, repo] = project.repo.split("/");
    const remote = yield* resolveOriginRemote();
    const host = Option.match(remote, { onNone: () => "github.com", onSome: (r) => r.host });
    const token = yield* credentials.token(host);
    return { ref: { host, owner: owner!, repo: repo! }, token };
  });
}
