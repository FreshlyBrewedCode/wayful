import { Effect } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "@domain/errors";
import type { ProjectHandle } from "@backend/ProjectStore";
import { ensureLabels, type Label } from "@backend/github/api";
import { GithubCredentials } from "@backend/github/credentials";
import { GithubHttp } from "@backend/github/http";
import { wayfulLabels } from "@backend/github/labels";
import { resolveRepo } from "@backend/github/repo";

/**
 * Reconciles the project's `wayful:*` label set with its type files: creates
 * the fixed primitive labels plus one `wayful:type/<name>` per type. Creating
 * an existing label is a no-op, so this is safe to run at any time — which is
 * the point, since types are hand-maintained files that can gain a member
 * without touching the CLI.
 */
export function syncLabels(
  project: ProjectHandle,
  typeNames: readonly string[],
): Effect.Effect<
  readonly string[],
  WayfulError,
  GithubCredentials | ChildProcessSpawner.ChildProcessSpawner | GithubHttp
> {
  return Effect.gen(function* () {
    const credentials = yield* GithubCredentials;
    const { ref, token } = yield* resolveRepo(project, credentials);
    const labels: ReadonlyArray<Label> = wayfulLabels(typeNames);
    yield* ensureLabels(ref, token, labels);
    return labels.map((label) => label.name);
  });
}
