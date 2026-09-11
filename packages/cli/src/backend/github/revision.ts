import { Effect, type Redacted } from "effect";

import type { WayfulError } from "../../domain/errors";
import { listIssues, listSubIssues } from "./api";
import type { GithubHttp } from "./http";
import type { GithubIssue } from "./issue";
import { WAYFUL_MAP_LABEL } from "./labels";
import type { GitRemoteRef } from "./remote";

/**
 * The server's records change only when someone else writes them, and GitHub
 * has no push channel a local process can hold. Polling is the only option;
 * every read it makes is a conditional `GET`, so a `304` serves the cached
 * body without spending rate-limit budget. An idle project therefore costs
 * nothing, and only a project that actually changed pays for one request.
 */
export const REVISION_POLL_MS = 4000;

/** The facts that make two reads of one issue different. */
function fingerprint(issue: GithubIssue): string {
  return JSON.stringify([issue.number, issue.updated_at, issue.state, issue.labels]);
}

/**
 * An opaque token over the project's map records and every map's sub-issues,
 * built entirely from conditional reads. That a sub-issue changed — its
 * labels, state or `updated_at` — changes its map's fingerprint, so the token
 * changes; nothing changed means every request is a `304` and the token is
 * identical. The token says *that* something changed, never *what*.
 */
export function readRevision(
  repo: GitRemoteRef,
  token: Redacted.Redacted<string>,
): Effect.Effect<string, WayfulError, GithubHttp> {
  return Effect.gen(function* () {
    const maps = yield* listIssues(repo, token, { labels: [WAYFUL_MAP_LABEL], state: "open" });
    const parts = [maps.map(fingerprint).join(",")];
    for (const map of maps) {
      const children = yield* listSubIssues(repo, token, map.number);
      parts.push(`${map.number}:${children.map(fingerprint).join(",")}`);
    }
    return parts.join("\n");
  });
}
