import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import { encodeIssueBody } from "../../../src/backend/github/issue";
import { MapStore } from "../../../src/backend/MapStore";
import type { MapHandle } from "../../../src/backend/MapStore";
import type { ProjectHandle } from "../../../src/backend/ProjectStore";
import type { Slot } from "../../../src/domain/identifier";
import type { GoalRecord, MapMetadata, NewGoalRecord } from "../../../src/domain/model";
import { ISSUE_TIME, bodyText, issueJson, jsonResponse } from "./support/issues";
import { runGithubMapStore } from "./support/store";

const project: ProjectHandle = {
  root: "/repo",
  description: "",
  backend: "github",
  repo: "acme/widgets",
};

function metadata(name: string): MapMetadata {
  return {
    format_version: 4,
    name,
    start: "here",
    allowed_step_types: undefined,
    created_at: ISSUE_TIME,
    updated_at: ISSUE_TIME,
  };
}

/** A map issue number is what a goal's sub-issue link and cap check address. */
function mapHandle(number = 7): MapHandle {
  return { project, name: "redesign", number, metadata: metadata("redesign") };
}

const EVIDENCE: readonly Slot[] = [{ name: "evidence", kind: "artifact" }];
const EVIDENCE_AND_NOTES: readonly Slot[] = [
  { name: "evidence", kind: "artifact" },
  { name: "notes", kind: "document" },
];

interface GoalFixture {
  readonly name: string;
  readonly description?: string;
  readonly outputs?: readonly unknown[];
  readonly required_outputs?: readonly Slot[];
  readonly body?: string;
}

/** A `wayful:goal` sub-issue as GitHub returns it, independent of the encoder under test. */
function goalIssue(
  number: number,
  fields: GoalFixture,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return issueJson(number, {
    title: fields.description ?? `goal ${number}`,
    labels: [{ name: "wayful:goal" }],
    body: encodeIssueBody(fields.body ?? "", {
      format_version: 4,
      name: fields.name,
      outputs: fields.outputs ?? [],
      required_outputs: fields.required_outputs ?? EVIDENCE,
    }),
    ...overrides,
  });
}

function newGoal(overrides: Partial<NewGoalRecord> = {}): NewGoalRecord {
  return {
    format_version: 4,
    name: "launch",
    description: "users can sign up",
    outputs: [],
    required_outputs: EVIDENCE,
    body: "the human prose",
    ...overrides,
  };
}

function goalRecord(overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    format_version: 4,
    name: "launch",
    description: "users can sign up",
    outputs: [],
    required_outputs: EVIDENCE,
    body: "",
    created_at: ISSUE_TIME,
    updated_at: ISSUE_TIME,
    ...overrides,
  };
}

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly body: unknown;
}

function recorder() {
  const requests: Recorded[] = [];
  const record = (request: HttpClientRequest.HttpClientRequest) => {
    const text = bodyText(request);
    requests.push({
      method: request.method,
      url: request.url,
      path: new URL(request.url).pathname,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    });
  };
  return {
    requests,
    record,
    find: (method: string, path: string) =>
      requests.find((r) => r.method === method && r.path === path),
    all: (method: string, path: string) =>
      requests.filter((r) => r.method === method && r.path === path),
  };
}

describe("GithubMapStore: createGoal", () => {
  test("creates a wayful:goal issue and links it as a sub-issue of the map", async () => {
    const { record, find } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues")) return jsonResponse(200, []);
        if (request.method === "POST" && path === "/repos/acme/widgets/issues") {
          const payload = JSON.parse(bodyText(request)) as {
            title: string;
            body: string;
            labels: string[];
          };
          return jsonResponse(
            201,
            issueJson(42, {
              id: 1042,
              title: payload.title,
              body: payload.body,
              labels: payload.labels.map((name) => ({ name })),
            }),
          );
        }
        if (request.method === "POST" && path.endsWith("/sub_issues")) return jsonResponse(201, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createGoal(mapHandle(), newGoal());
      }),
    );

    const payload = find("POST", "/repos/acme/widgets/issues")!.body as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(payload.labels).toEqual(["wayful:goal"]);
    // The title is the goal's description; the body carries the structured
    // residue and the human prose.
    expect(payload.title).toBe("users can sign up");
    expect(payload.body).toContain("the human prose");
    expect(payload.body).toContain("name: launch");
    expect(payload.body).toContain("required_outputs:");
    // Single representation per fact: neither the kind (a label) nor the
    // description (the title) is repeated into the body.
    expect(payload.body).not.toContain("wayful:goal");
    expect(payload.body).not.toContain("users can sign up");

    // Parentage is by the created issue's database id, not its number.
    expect(find("POST", "/repos/acme/widgets/issues/7/sub_issues")?.body).toEqual({
      sub_issue_id: 1042,
    });
  });

  test("refuses to create a goal whose name already exists", async () => {
    const { record, find } = recorder();
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(200, [goalIssue(5, { name: "launch" })]);
        throw new Error("must not create a duplicate");
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.createGoal(mapHandle(), newGoal()));
      }),
    );
    expect(error.message).toBe("goal 'launch' already exists.");
    expect(find("POST", "/repos/acme/widgets/issues")).toBeUndefined();
  });

  test("the shared 100-sub-issue cap is the named error, not a raw API failure", async () => {
    const { record, find } = recorder();
    // Steps filled the budget; a goal is the 101st child and must be refused.
    const full = Array.from({ length: 100 }, (_, index) =>
      issueJson(index + 1, { labels: [{ name: "wayful:step" }] }),
    );
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        if (request.method === "GET") return jsonResponse(200, full);
        throw new Error("must not create past the cap");
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.createGoal(mapHandle(), newGoal()));
      }),
    );
    expect(error.message).toContain("100");
    expect(error.message).toContain("steps and goals share");
    expect(find("POST", "/repos/acme/widgets/issues")).toBeUndefined();
  });
});

describe("GithubMapStore: listGoals", () => {
  test("reads goals from the map's sub-issues, including satisfied (closed) ones", async () => {
    const result = await runGithubMapStore(
      (request) => {
        if (request.method === "GET" && new URL(request.url).pathname.endsWith("/sub_issues"))
          return jsonResponse(200, [
            goalIssue(52, { name: "zeta", description: "z" }, { state: "closed" }),
            goalIssue(50, { name: "alpha", description: "a" }),
            issueJson(51, { title: "a step", labels: [{ name: "wayful:step" }] }),
          ]);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listGoals(mapHandle());
      }),
    );
    expect(result.records.map((goal) => goal.name)).toEqual(["alpha", "zeta"]);
    expect(result.errors).toEqual([]);
  });

  test("a malformed goal is a DecodeError beside its healthy siblings", async () => {
    const result = await runGithubMapStore(
      (request) => {
        if (request.method === "GET" && new URL(request.url).pathname.endsWith("/sub_issues"))
          return jsonResponse(200, [
            goalIssue(50, { name: "alpha", description: "a" }),
            issueJson(52, {
              title: "broken",
              labels: [{ name: "wayful:goal" }],
              body: "no details here",
            }),
          ]);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listGoals(mapHandle());
      }),
    );
    expect(result.records.map((goal) => goal.name)).toEqual(["alpha"]);
    expect(result.errors).toEqual([{ file: "#52", message: expect.stringContaining("details") }]);
  });
});

describe("GithubMapStore: saveGoal", () => {
  test("closes the issue as completed once every required output slot is filled", async () => {
    const { record, all } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            goalIssue(50, { name: "launch", description: "users can sign up" }),
          ]);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/50")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.saveGoal(
          mapHandle(),
          goalRecord({ outputs: [{ slot: "evidence", ref: "file:docs/evidence.md" }] }),
        );
      }),
    );

    const patches = all("PATCH", "/repos/acme/widgets/issues/50");
    expect(patches).toHaveLength(2);
    expect(patches[0]!.body).toMatchObject({
      body: expect.stringContaining("file:docs/evidence.md"),
    });
    expect((patches[0]!.body as { state?: unknown }).state).toBeUndefined();
    expect(patches[1]!.body).toEqual({ state: "closed", state_reason: "completed" });
  });

  test("keeps the issue open while a required output slot is still unfilled", async () => {
    const { record, all } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            goalIssue(50, {
              name: "launch",
              description: "users can sign up",
              required_outputs: EVIDENCE_AND_NOTES,
            }),
          ]);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/50")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.saveGoal(
          mapHandle(),
          goalRecord({
            required_outputs: EVIDENCE_AND_NOTES,
            outputs: [{ slot: "evidence", ref: "file:docs/evidence.md" }],
          }),
        );
      }),
    );

    const patches = all("PATCH", "/repos/acme/widgets/issues/50");
    expect(patches).toHaveLength(1);
    expect((patches[0]!.body as { state?: unknown }).state).toBeUndefined();
  });

  test("reopens a satisfied goal whose required outputs are gone", async () => {
    const { record, all } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            goalIssue(
              50,
              { name: "launch", description: "users can sign up" },
              { state: "closed" },
            ),
          ]);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/50")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.saveGoal(mapHandle(), goalRecord());
      }),
    );

    const patches = all("PATCH", "/repos/acme/widgets/issues/50");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ state: "open" });
  });
});

describe("GithubMapStore: createMap's initial goal", () => {
  test("creates it as a sub-issue with its default slot", async () => {
    const { record, find, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/repos/acme/widgets/issues")
          return jsonResponse(200, []);
        if (request.method === "POST" && path === "/repos/acme/widgets/issues") {
          const payload = JSON.parse(bodyText(request)) as { labels: string[] };
          const number = payload.labels.includes("wayful:map") ? 42 : 43;
          return jsonResponse(201, issueJson(number, { id: number + 1000 }));
        }
        if (request.method === "POST" && path === "/repos/acme/widgets/issues/42/sub_issues")
          return jsonResponse(201, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createMap(project, {
          name: "roadmap",
          start: "ship it",
          goal: "users can sign up",
          goalBody: "the human prose",
        });
      }),
    );

    const goalPost = requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/repos/acme/widgets/issues" &&
        (request.body as { labels: string[] }).labels.includes("wayful:goal"),
    )!;
    const payload = goalPost.body as { title: string; body: string; labels: string[] };
    expect(payload.labels).toEqual(["wayful:goal"]);
    expect(payload.title).toBe("users can sign up");
    expect(payload.body).toContain("the human prose");
    expect(payload.body).toContain("name: initial-goal");
    expect(payload.body).toContain("required_outputs:");
    expect(payload.body).toContain("name: evidence");
    expect(payload.body).toContain("kind: artifact");

    expect(find("POST", "/repos/acme/widgets/issues/42/sub_issues")?.body).toEqual({
      sub_issue_id: 1043,
    });
  });
});
