import { Effect, Option } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import { verifyAccess } from "@backend/github/api";
import { GithubCredentials, type GithubCredentialSource } from "@backend/github/credentials";
import { GithubHttp, type RateLimit } from "@backend/github/http";
import { wayfulLabels } from "@backend/github/labels";
import { resolveRepoRef } from "@backend/github/repo";
import type { ProjectHandle } from "@backend/ProjectStore";
import { WayfulError } from "@domain/errors";

/**
 * Everything a github-backed project needs, resolved in one place. A healthy
 * project yields this; the first missing piece fails with a `WayfulError` that
 * names it, so a first-run failure is readable instead of an opaque HTTP
 * status.
 */
export interface GithubDiagnosis {
  readonly repository: string;
  readonly host: string;
  readonly credential: GithubCredentialSource;
  readonly labels: readonly string[];
  readonly rateLimit: Option.Option<RateLimit>;
}

/**
 * Resolves the repository, host, credential, labels, and rate-limit budget of
 * a github-backed project. Credential resolution is wrapped so an unusable
 * credential is named as such rather than surfacing as a bare missing-token
 * message; the access check then names the token if it cannot reach the repo.
 */
export function diagnoseGithub(
  project: ProjectHandle,
  typeNames: readonly string[],
): Effect.Effect<
  GithubDiagnosis,
  WayfulError,
  GithubCredentials | ChildProcessSpawner.ChildProcessSpawner | GithubHttp
> {
  return Effect.gen(function* () {
    const ref = yield* resolveRepoRef(project);
    const credentials = yield* GithubCredentials;
    const credential = yield* credentials
      .resolve(ref.host)
      .pipe(
        Effect.mapError(
          (error) => new WayfulError({ message: `github credential: ${error.message}` }),
        ),
      );
    yield* verifyAccess(ref, credential.token);
    const http = yield* GithubHttp;
    const rateLimit = yield* http.rateLimit;
    return {
      repository: `${ref.owner}/${ref.repo}`,
      host: ref.host,
      credential: credential.source,
      labels: wayfulLabels(typeNames).map((label) => label.name),
      rateLimit,
    };
  });
}
