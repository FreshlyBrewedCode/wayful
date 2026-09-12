import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import { encodeIssueBody } from "../../../src/backend/github/issue";
import { mapIssueData } from "../../../src/backend/github/map";
import { MapStore } from "../../../src/backend/MapStore";
import type { ProjectHandle } from "../../../src/backend/ProjectStore";
import type { MapMetadata } from "../../../src/domain/model";
import { runGithubMapStore } from "./support/store";
import { ISSUE_TIME, bodyText, issueJson, jsonResponse } from "./support/issues";

const project: ProjectHandle = {
  root: "/repo",
  description: "",
  backend: "github",
  repo: "acme/widgets",
};

function mapIssue(
  number: number,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return issueJson(number, { body: encodeIssueBody("", mapIssueData(name)), ...overrides });
}

/**
 * Runs `effect` against `GithubMapStore` with a stubbed `HttpClient` (the only
 * network seam), a stubbed `ChildProcessSpawner` for `git remote get-url` and
 * a fixed credential. The Search API is actively forbidden: any request to
 * `/search/` throws, which is what makes the "never the Search API" criterion
 * a real guard rather than a comment.
 */
function run<A, E>(
  http: (request: HttpClientRequest.HttpClientRequest) => Response,
  effect: Effect.Effect<A, E, MapStore>,
  options: { readonly remote?: string | null } = {},
): Promise<A> {
  return runGithubMapStore(http, effect, options);
}

function metadata(name: string, start: string): MapMetadata {
  return {
    format_version: 4,
    name,
    start,
    allowed_step_types: undefined,
    created_at: ISSUE_TIME,
    updated_at: ISSUE_TIME,
  };
}

describe("GithubMapStore: createMap", () => {
  test("creates an issue labelled wayful:map, titled from the start, with the details block in the body", async () => {
    let created: HttpClientRequest.HttpClientRequest | undefined;
    await run(
      (request) => {
        const pathname = new URL(request.url).pathname;
        if (request.method === "GET") return jsonResponse(200, []);
        if (pathname.endsWith("/sub_issues")) return jsonResponse(201, issueJson(13));
        const body = JSON.parse(bodyText(request)) as { labels: string[] };
        if (!body.labels.includes("wayful:map")) return jsonResponse(201, issueJson(13));
        created = request;
        return jsonResponse(201, issueJson(12, { title: "here" }));
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createMap(project, {
          name: "redesign",
          start: "here",
          goal: "done",
          goalBody: "",
        });
      }),
    );
    expect(created?.method).toBe("POST");
    expect(created?.url).toBe("https://api.github.com/repos/acme/widgets/issues");
    const payload = JSON.parse(bodyText(created!)) as { body: string };
    expect(JSON.parse(bodyText(created!))).toEqual({
      title: "here",
      body: expect.stringContaining("```yaml\nformat_version: 4\nname: redesign\n"),
      labels: ["wayful:map"],
    });
    // Single representation per fact: the kind is a label, never repeated in
    // the body.
    expect(payload.body).not.toContain("wayful:map");
  });

  test("refuses to create a map whose name already exists", async () => {
    const error = await run(
      (request) => {
        if (request.method === "GET") return jsonResponse(200, [mapIssue(3, "redesign")]);
        throw new Error("must not create a duplicate");
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(
          store.createMap(project, { name: "redesign", start: "here", goal: "done", goalBody: "" }),
        );
      }),
    );
    expect(error.message).toBe("map 'redesign' already exists.");
  });

  test("rejects a non-kebab-case map name before any request", async () => {
    const error = await run(
      () => {
        throw new Error("must not make a request");
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(
          store.createMap(project, {
            name: "Not Valid",
            start: "here",
            goal: "done",
            goalBody: "",
          }),
        );
      }),
    );
    expect(error.message).toContain("map name");
  });
});

describe("GithubMapStore: listMaps", () => {
  test("resolves maps from a label-filtered, open-only issue listing", async () => {
    let seen = "";
    const maps = await run(
      (request) => {
        seen = request.url;
        return jsonResponse(200, [mapIssue(3, "alpha", { title: "first" })]);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return (yield* store.listMaps(project)).records;
      }),
    );
    const url = new URL(seen);
    expect(url.pathname).toBe("/repos/acme/widgets/issues");
    expect(url.searchParams.get("labels")).toBe("wayful:map");
    expect(url.searchParams.get("state")).toBe("open");
    expect(maps).toEqual([metadata("alpha", "first")]);
  });

  test("sorts maps by name", async () => {
    const maps = await run(
      () =>
        jsonResponse(200, [
          mapIssue(3, "zeta", { title: "z" }),
          mapIssue(4, "alpha", { title: "a" }),
        ]),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return (yield* store.listMaps(project)).records.map((map) => map.name);
      }),
    );
    expect(maps).toEqual(["alpha", "zeta"]);
  });

  test("a map created and immediately listed is always visible", async () => {
    const issues: Record<string, unknown>[] = [];
    const names = await run(
      (request) => {
        const pathname = new URL(request.url).pathname;
        if (request.method === "POST" && pathname.endsWith("/sub_issues"))
          return jsonResponse(201, issueJson(43));
        if (request.method === "POST") {
          const body = JSON.parse(bodyText(request)) as {
            title: string;
            body: string;
            labels: string[];
          };
          const created = issueJson(body.labels.includes("wayful:map") ? 42 : 43, {
            title: body.title,
            body: body.body,
            labels: body.labels.map((name) => ({ name })),
          });
          issues.push(created);
          return jsonResponse(201, created);
        }
        return jsonResponse(200, issues);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createMap(project, {
          name: "alpha",
          start: "here",
          goal: "done",
          goalBody: "",
        });
        return (yield* store.listMaps(project)).records.map((map) => map.name);
      }),
    );
    expect(names).toEqual(["alpha"]);
  });

  test("a closed map issue is invisible even if the listing returns it", async () => {
    const result = await run(
      () =>
        jsonResponse(200, [
          mapIssue(9, "archived", { title: "archived", state: "closed" }),
          mapIssue(10, "live", { title: "live" }),
        ]),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listMaps(project);
      }),
    );
    expect(result.records.map((map) => map.name)).toEqual(["live"]);
    expect(result.errors).toEqual([]);
  });

  // The listing filters by label server-side, so a de-labelled map is
  // normally just absent. This proves the decoder never trusts the filter: if
  // a listing hands back a map body without the label, it is a skipped
  // DecodeError, not a phantom map — the same data-loss machinery the step and
  // goal slices inherit.
  test("a returned map body without its wayful:map label is a DecodeError beside healthy siblings", async () => {
    const result = await run(
      () =>
        jsonResponse(200, [
          mapIssue(3, "alpha", { title: "healthy" }),
          mapIssue(4, "beta", { title: "broken", labels: [] }),
        ]),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listMaps(project);
      }),
    );
    expect(result.records.map((map) => map.name)).toEqual(["alpha"]);
    expect(result.errors).toEqual([{ file: "#4", message: expect.stringContaining("wayful:map") }]);
  });

  test("a map issue with a malformed body is a DecodeError beside its healthy siblings", async () => {
    const result = await run(
      () =>
        jsonResponse(200, [
          mapIssue(3, "alpha", { title: "healthy" }),
          issueJson(4, { title: "broken", body: "no details here" }),
        ]),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listMaps(project);
      }),
    );
    expect(result.records.map((map) => map.name)).toEqual(["alpha"]);
    expect(result.errors[0]?.file).toBe("#4");
  });
});

describe("GithubMapStore: openMap", () => {
  test("resolves a kebab-case name to its issue", async () => {
    const map = await run(
      () =>
        jsonResponse(200, [
          mapIssue(3, "alpha", { title: "first" }),
          mapIssue(7, "beta", { title: "second" }),
        ]),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.openMap(project, "beta");
      }),
    );
    expect(map.metadata).toEqual(metadata("beta", "second"));
  });

  test("reports a closed map as absent", async () => {
    const error = await run(
      () => jsonResponse(200, []),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.openMap(project, "archived"));
      }),
    );
    expect(error.message).toBe("map 'archived' does not exist.");
  });

  test("uses the enterprise host resolved from the remote", async () => {
    let seen = "";
    await run(
      (request) => {
        seen = request.url;
        return jsonResponse(200, []);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listMaps(project);
      }),
      { remote: "git@github.example.com:acme/widgets.git" },
    );
    expect(seen).toBe(
      "https://github.example.com/api/v3/repos/acme/widgets/issues?per_page=100&state=open&labels=wayful%3Amap",
    );
  });
});
