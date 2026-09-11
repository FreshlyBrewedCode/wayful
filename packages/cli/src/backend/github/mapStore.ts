import { Effect, Layer, Option, Ref, type Redacted } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "../../domain/errors";
import { identifier, nonEmpty } from "../../domain/identifier";
import type { DecodeError, MapMetadata } from "../../domain/model";
import { liftSync } from "../effect";
import { MapStore } from "../MapStore";
import type { ProjectHandle } from "../ProjectStore";
import { createIssue, listIssues } from "./api";
import { GithubCredentials } from "./credentials";
import { encodeIssueBody } from "./issue";
import { WAYFUL_MAP_LABEL } from "./labels";
import { decodeMapIssue, mapIssueData } from "./map";
import { resolveOriginRemote, type GitRemoteRef } from "./remote";

interface ResolvedRepo {
  readonly ref: GitRemoteRef;
  readonly token: Redacted.Redacted<string>;
}

const fail = (message: string) => Effect.fail(new WayfulError({ message }));

const unsupported = (what: string) => fail(`the github backend does not support ${what} yet.`);

function resolveRepo(project: ProjectHandle, credentials: GithubCredentials["Service"]) {
  return Effect.gen(function* () {
    if (project.backend !== "github" || project.repo === undefined)
      return yield* fail("project is not configured for the github backend.");
    const [owner, repo] = project.repo.split("/");
    const remote = yield* resolveOriginRemote();
    const host = Option.match(remote, { onNone: () => "github.com", onSome: (r) => r.host });
    const token = yield* credentials.token(host);
    return { ref: { host, owner: owner!, repo: repo! }, token };
  });
}

/**
 * The GitHub `MapStore`. Maps are issues labelled `wayful:map`; a map's title
 * is its `start` and its body carries `name` and the remaining structured
 * fields. Reads list label-filtered issues — never the Search API, which is
 * eventually consistent — and closed map issues are simply absent, the same
 * effect as deleting a map folder. Steps and goals are later slices
 * (#36/#37), so those operations fail explicitly rather than lying.
 *
 * The infrastructure services are resolved once at construction and closed
 * over, so the returned methods carry no environment of their own: a layer
 * whose methods leak requirements would appear to be provided while failing at
 * the first call.
 */
export function makeGithubMapStore() {
  return Effect.gen(function* () {
    const credentials = yield* GithubCredentials;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const http = yield* HttpClient.HttpClient;
    const cache = yield* Ref.make(new Map<string, ResolvedRepo>());

    const withInfra = <A, E>(
      effect: Effect.Effect<A, E, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner>,
    ) =>
      effect.pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

    // One project means one repo + token for the life of the process; the
    // per-project cache keeps a command from resolving them per call.
    const context = (project: ProjectHandle) =>
      withInfra(
        Effect.gen(function* () {
          const existing = (yield* Ref.get(cache)).get(project.root);
          if (existing !== undefined) return existing;
          const resolved = yield* resolveRepo(project, credentials);
          yield* Ref.update(cache, (map) => new Map(map).set(project.root, resolved));
          return resolved;
        }),
      );

    const listMapIssues = (project: ProjectHandle) =>
      withInfra(
        Effect.gen(function* () {
          const { ref, token } = yield* context(project);
          return yield* listIssues(ref, token, { labels: [WAYFUL_MAP_LABEL], state: "open" });
        }),
      );

    const listMaps = (project: ProjectHandle) =>
      withInfra(
        Effect.gen(function* () {
          const issues = yield* listMapIssues(project);
          const records: MapMetadata[] = [];
          const errors: DecodeError[] = [];
          for (const issue of issues) {
            // `state=open` already excludes closed issues server-side; this is
            // the belt to that braces, so a closed map is never returned.
            if (issue.state !== "open") continue;
            try {
              records.push(decodeMapIssue(issue));
            } catch (error) {
              errors.push({
                file: `#${issue.number}`,
                message: error instanceof WayfulError ? error.message : String(error),
              });
            }
          }
          records.sort((a, b) => a.name.localeCompare(b.name));
          return { records, errors };
        }),
      );

    const createMap = (
      project: ProjectHandle,
      {
        name,
        start,
      }: {
        readonly name: string;
        readonly start: string;
        readonly goal: string;
        readonly goalBody: string;
      },
    ) =>
      withInfra(
        Effect.gen(function* () {
          yield* liftSync(() => identifier(name, "map name", true));
          const trimmedStart = yield* liftSync(() => nonEmpty(start, "map start"));
          const issues = yield* listMapIssues(project);
          const existing = issues
            .filter((issue) => issue.state === "open")
            .map((issue) => {
              try {
                return decodeMapIssue(issue).name;
              } catch {
                return undefined;
              }
            });
          if (existing.includes(name)) return yield* fail(`map '${name}' already exists.`);
          const { ref, token } = yield* context(project);
          yield* createIssue(ref, token, {
            title: trimmedStart,
            body: encodeIssueBody("", mapIssueData(name)),
            labels: [WAYFUL_MAP_LABEL],
          });
        }),
      );

    const openMap = (project: ProjectHandle, name: string) =>
      withInfra(
        Effect.gen(function* () {
          yield* liftSync(() => identifier(name, "map name", true));
          const { records } = yield* listMaps(project);
          const metadata = records.find((candidate) => candidate.name === name);
          if (metadata === undefined) return yield* fail(`map '${name}' does not exist.`);
          return { project, name, metadata };
        }),
      );

    return MapStore.of({
      listMaps,
      createMap,
      openMap,
      listSteps: () => unsupported("steps"),
      createStep: () => unsupported("steps"),
      saveStep: () => unsupported("steps"),
      listGoals: () => unsupported("goals"),
      createGoal: () => unsupported("goals"),
      saveGoal: () => unsupported("goals"),
      // A later slice (#39) replaces this with one GraphQL query; until steps
      // and goals exist under this backend there is nothing to assemble.
      snapshot: (map) =>
        Effect.succeed({
          snapshot: { map: map.metadata, steps: [], artifacts: [], goals: [], types: [] },
          errors: [],
        }),
    });
  });
}

export const GithubMapStore = Layer.effect(MapStore, makeGithubMapStore());
