import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import { encodeIssueBody } from "../../../src/backend/github/issue";
import type { MapHandle } from "../../../src/backend/MapStore";
import { MapStore } from "../../../src/backend/MapStore";
import type { ProjectHandle } from "../../../src/backend/ProjectStore";
import type { WayfulError } from "../../../src/domain/errors";
import type { MapMetadata, NewStepRecord, StepRecord } from "../../../src/domain/model";
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

/** A map issue number is what a step's sub-issue link and cap check address. */
function mapHandle(number = 7): MapHandle {
  return { project, name: "redesign", number, metadata: metadata("redesign") };
}

interface StepFixture {
  readonly name: string;
  readonly description: string;
  readonly type?: string;
  readonly body?: string;
  readonly inputs?: readonly unknown[];
  readonly outputs?: readonly unknown[];
  readonly required_inputs?: readonly unknown[];
  readonly required_outputs?: readonly unknown[];
  readonly block_reason?: string;
  readonly completion_summary?: string;
  readonly cancellation_reason?: string;
}

/** A `wayful:step` sub-issue as GitHub returns it, independent of the encoder under test. */
function stepIssue(
  number: number,
  fields: StepFixture,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    format_version: 4,
    name: fields.name,
    inputs: fields.inputs ?? [],
    outputs: fields.outputs ?? [],
    required_inputs: fields.required_inputs ?? [],
    required_outputs: fields.required_outputs ?? [],
  };
  if (fields.block_reason !== undefined) data.block_reason = fields.block_reason;
  if (fields.completion_summary !== undefined) data.completion_summary = fields.completion_summary;
  if (fields.cancellation_reason !== undefined)
    data.cancellation_reason = fields.cancellation_reason;
  return issueJson(number, {
    title: fields.description,
    body: encodeIssueBody(fields.body ?? "", data),
    labels: [{ name: "wayful:step" }, { name: `wayful:type/${fields.type ?? "research"}` }],
    ...overrides,
  });
}

function blockedLabels(): readonly { readonly name: string }[] {
  return [{ name: "wayful:step" }, { name: "wayful:type/research" }, { name: "wayful:blocked" }];
}

function newStep(overrides: Partial<NewStepRecord> = {}): NewStepRecord {
  return {
    format_version: 4,
    name: "research-users",
    type: "research",
    description: "Identify the most important problems",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [{ name: "brief", kind: "document" }],
    required_outputs: [],
    body: "Focus on checkout.",
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
  };
}

/**
 * Loads one step through `listSteps`, so a `saveStep` test starts from exactly
 * what the CLI would have read before mutating.
 */
function loadStep(): Effect.Effect<StepRecord, WayfulError, MapStore> {
  return Effect.gen(function* () {
    const store = yield* MapStore;
    return (yield* store.listSteps(mapHandle())).records[0]!;
  });
}

describe("GithubMapStore: createStep", () => {
  test("creates the step issue, ensures its type label, and links it as a sub-issue", async () => {
    const { record, find } = recorder();
    const created = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues")) return jsonResponse(200, []);
        if (request.method === "POST" && path === "/repos/acme/widgets/labels")
          return jsonResponse(201, {});
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
        return yield* store.createStep(mapHandle(), newStep());
      }),
    );

    expect(created.id).toBe(42);
    expect(created.name).toBe("research-users");
    expect(created.status).toBe("pending");

    expect(find("POST", "/repos/acme/widgets/labels")?.body).toMatchObject({
      name: "wayful:type/research",
    });

    const payload = find("POST", "/repos/acme/widgets/issues")!.body as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(payload.title).toBe("Identify the most important problems");
    expect(payload.labels).toEqual(["wayful:step", "wayful:type/research"]);
    expect(payload.body).toContain("name: research-users");
    expect(payload.body).toContain("brief");
    expect(payload.body).toContain("Focus on checkout.");
    // Single representation per fact: the type is a label, never repeated in the body.
    expect(payload.body).not.toContain("type: research");

    expect(find("POST", "/repos/acme/widgets/issues/7/sub_issues")?.body).toEqual({
      sub_issue_id: 1042,
    });
  });

  test("applies a blocked status natively when the record is created blocked", async () => {
    const { record, find } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues")) return jsonResponse(200, []);
        if (request.method === "POST" && path === "/repos/acme/widgets/labels")
          return jsonResponse(201, {});
        if (request.method === "POST" && path === "/repos/acme/widgets/issues")
          return jsonResponse(201, issueJson(42, { id: 1042 }));
        if (request.method === "POST" && path.endsWith("/sub_issues")) return jsonResponse(201, {});
        if (request.method === "POST" && path === "/repos/acme/widgets/issues/42/labels")
          return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createStep(
          mapHandle(),
          newStep({ status: "blocked", block_reason: "waiting" }),
        );
      }),
    );
    expect(find("POST", "/repos/acme/widgets/issues/42/labels")?.body).toEqual({
      labels: ["wayful:blocked"],
    });
  });

  test("applies a terminal status natively when the record is created terminal", async () => {
    const { record, find } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues")) return jsonResponse(200, []);
        if (request.method === "POST" && path === "/repos/acme/widgets/labels")
          return jsonResponse(201, {});
        if (request.method === "POST" && path === "/repos/acme/widgets/issues")
          return jsonResponse(201, issueJson(42, { id: 1042 }));
        if (request.method === "POST" && path.endsWith("/sub_issues")) return jsonResponse(201, {});
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/42")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createStep(
          mapHandle(),
          newStep({ status: "complete", completion_summary: "done" }),
        );
      }),
    );
    expect(find("PATCH", "/repos/acme/widgets/issues/42")?.body).toEqual({
      state: "closed",
      state_reason: "completed",
    });
  });

  test("links a non-empty dependency set as native blocked_by edges on creation", async () => {
    const { record, find } = recorder();
    const existingStep = stepIssue(9, { name: "gamma", description: "third" });
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(200, [existingStep]);
        if (request.method === "POST" && path === "/repos/acme/widgets/labels")
          return jsonResponse(201, {});
        if (request.method === "POST" && path === "/repos/acme/widgets/issues")
          return jsonResponse(201, issueJson(42, { id: 1042 }));
        if (request.method === "POST" && path.endsWith("/sub_issues")) return jsonResponse(201, {});
        if (
          request.method === "POST" &&
          path === "/repos/acme/widgets/issues/42/dependencies/blocked_by"
        )
          return jsonResponse(201, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* store.createStep(mapHandle(), newStep({ dependencies: [9] }));
      }),
    );
    expect(find("POST", "/repos/acme/widgets/issues/42/dependencies/blocked_by")?.body).toEqual({
      issue_id: 1009,
    });
  });

  test("rejects a creation whose dependency is not a step of the same map before creating it", async () => {
    const { record, requests } = recorder();
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues")) return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.createStep(mapHandle(), newStep({ dependencies: [9] })));
      }),
    );
    expect(error.message).toContain("same map");
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  test("the 101st sub-issue is a named error explaining the shared cap, not a raw API failure", async () => {
    const { record, find } = recorder();
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/sub_issues"))
          return jsonResponse(
            200,
            Array.from({ length: 100 }, (_, index) => issueJson(index + 1)),
          );
        throw new Error("must not create past the cap");
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.createStep(mapHandle(), newStep()));
      }),
    );

    expect(error.message).toContain("100");
    expect(error.message).toContain("sub-issue");
    expect(find("POST", "/repos/acme/widgets/issues")).toBeUndefined();
  });
});

describe("GithubMapStore: listSteps", () => {
  test("resolves steps from the map's sub-issues, sorted by issue number", async () => {
    const steps = await runGithubMapStore(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            stepIssue(5, { name: "beta", description: "second" }),
            stepIssue(3, { name: "alpha", description: "first" }),
          ]);
        if (path.endsWith("/dependencies/blocked_by")) return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return (yield* store.listSteps(mapHandle())).records;
      }),
    );
    expect(steps.map((step) => step.id)).toEqual([3, 5]);
    expect(steps.map((step) => step.name)).toEqual(["alpha", "beta"]);
    expect(steps.map((step) => step.description)).toEqual(["first", "second"]);
  });

  test("round-trips all four statuses through native state and the blocked label", async () => {
    const steps = await runGithubMapStore(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            stepIssue(3, { name: "pending", description: "p" }),
            stepIssue(
              4,
              { name: "blocked", description: "b", block_reason: "waiting" },
              { labels: blockedLabels() },
            ),
            stepIssue(
              5,
              { name: "complete", description: "c", completion_summary: "done" },
              { state: "closed", state_reason: "completed", closed_at: ISSUE_TIME },
            ),
            stepIssue(
              6,
              { name: "cancelled", description: "x", cancellation_reason: "dropped" },
              { state: "closed", state_reason: "not_planned", closed_at: ISSUE_TIME },
            ),
          ]);
        if (path.endsWith("/dependencies/blocked_by")) return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return (yield* store.listSteps(mapHandle())).records.map((step) => step.status);
      }),
    );
    expect(steps).toEqual(["pending", "blocked", "complete", "cancelled"]);
  });

  test("ignores sub-issues that are not steps and reports malformed steps beside healthy ones", async () => {
    const result = await runGithubMapStore(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/sub_issues"))
          return jsonResponse(200, [
            issueJson(2, { labels: [{ name: "wayful:goal" }] }),
            stepIssue(3, { name: "alpha", description: "healthy" }),
            issueJson(4, { labels: [{ name: "wayful:step" }], body: "no details here" }),
          ]);
        if (path.endsWith("/dependencies/blocked_by")) return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listSteps(mapHandle());
      }),
    );
    expect(result.records.map((step) => step.id)).toEqual([3]);
    expect(result.errors).toEqual([{ file: "#4", message: expect.stringContaining("details") }]);
  });

  test("reads each step's dependencies from GitHub's native blocked_by edges, never the body", async () => {
    const steps = await runGithubMapStore(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [
            stepIssue(3, { name: "alpha", description: "first" }),
            stepIssue(5, { name: "beta", description: "second" }),
          ]);
        if (path.endsWith("/issues/3/dependencies/blocked_by"))
          return jsonResponse(200, [issueJson(5, { id: 1005 })]);
        if (path.endsWith("/issues/5/dependencies/blocked_by")) return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return (yield* store.listSteps(mapHandle())).records;
      }),
    );
    expect(steps.map((step) => step.dependencies)).toEqual([[5], []]);
  });

  test("rejects a dependency that is not a wayful:step sub-issue of the same map", async () => {
    const result = await runGithubMapStore(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [stepIssue(3, { name: "alpha", description: "first" })]);
        if (path.endsWith("/issues/3/dependencies/blocked_by"))
          return jsonResponse(200, [issueJson(99, { id: 1099 })]);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.listSteps(mapHandle());
      }),
    );
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([{ file: "#3", message: expect.stringContaining("same map") }]);
  });
});

describe("GithubMapStore: saveStep status transitions", () => {
  test("pending -> blocked adds the blocked label and records the reason in the body without a state edit", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "POST" && path === "/repos/acme/widgets/issues/5/labels")
          return jsonResponse(200, []);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), {
          ...step,
          status: "blocked",
          block_reason: "waiting",
        });
      }),
    );
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      labels: ["wayful:blocked"],
    });
    const patches = requests.filter((r) => r.method === "PATCH").map((r) => r.body);
    expect(patches).toHaveLength(1);
    expect(patches[0]).not.toHaveProperty("state");
    expect((patches[0] as { body: string }).body).toContain("block_reason: waiting");
    expect((patches[0] as { body: string }).body).toContain("name: alpha");
  });

  test("blocked -> pending removes the blocked label and clears the reason without a state edit", async () => {
    const current = stepIssue(
      5,
      { name: "alpha", description: "first", block_reason: "waiting" },
      { labels: blockedLabels() },
    );
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "DELETE" && path.startsWith("/repos/acme/widgets/issues/5/labels/"))
          return jsonResponse(200, {});
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        const { block_reason: _blockReason, ...rest } = step;
        yield* store.saveStep(mapHandle(), { ...rest, status: "pending" });
      }),
    );
    const removal = requests.find((r) => r.method === "DELETE");
    expect(removal && decodeURIComponent(removal.path).endsWith("/labels/wayful:blocked")).toBe(
      true,
    );
    const patches = requests.filter((r) => r.method === "PATCH").map((r) => r.body);
    expect(patches.every((patch) => !("state" in (patch as object)))).toBe(true);
    expect((patches[0] as { body: string }).body).not.toContain("block_reason");
  });

  test("complete persists the summary in the body and closes as completed in a body-free state edit", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), {
          ...step,
          status: "complete",
          completion_summary: "done",
        });
      }),
    );
    const patches = requests
      .filter((r) => r.method === "PATCH")
      .map((r) => r.body as Record<string, unknown>);
    const state = patches.find((patch) => patch.state !== undefined);
    expect(state).toEqual({ state: "closed", state_reason: "completed" });
    expect(state).not.toHaveProperty("body");
    const body = patches.find((patch) => patch.body !== undefined);
    expect(body?.body).toContain("completion_summary: done");
  });

  test("cancelled closes as not_planned", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), {
          ...step,
          status: "cancelled",
          cancellation_reason: "dropped",
        });
      }),
    );
    const patches = requests
      .filter((r) => r.method === "PATCH")
      .map((r) => r.body as Record<string, unknown>);
    expect(patches.find((patch) => patch.state !== undefined)).toEqual({
      state: "closed",
      state_reason: "not_planned",
    });
  });

  test("adding a dependency posts a native blocked_by edge and never rewrites the body", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const prerequisite = stepIssue(9, { name: "gamma", description: "third" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current, prerequisite]);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "GET" && path.endsWith("/dependencies/blocked_by"))
          return jsonResponse(200, []);
        if (
          request.method === "POST" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(201, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), { ...step, dependencies: [9] });
      }),
    );
    const add = requests.find(
      (r) =>
        r.method === "POST" && r.path === "/repos/acme/widgets/issues/5/dependencies/blocked_by",
    );
    expect(add?.body).toEqual({ issue_id: 1009 });
    // A dependency change is a native edge, never a body edit.
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  test("removing a dependency deletes the native edge and never rewrites the body", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const prerequisite = stepIssue(9, { name: "gamma", description: "third" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current, prerequisite]);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "GET" && path.endsWith("/dependencies/blocked_by"))
          return path.includes("/issues/5/")
            ? jsonResponse(200, [issueJson(9, { id: 1009 })])
            : jsonResponse(200, []);
        if (
          request.method === "DELETE" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by/1009"
        )
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), { ...step, dependencies: [] });
      }),
    );
    expect(
      requests.some(
        (r) =>
          r.method === "DELETE" &&
          r.path === "/repos/acme/widgets/issues/5/dependencies/blocked_by/1009",
      ),
    ).toBe(true);
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  test("rejects a dependency that is not a wayful:step sub-issue of the same map", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const { record, requests } = recorder();
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        return yield* Effect.flip(store.saveStep(mapHandle(), { ...step, dependencies: [9] }));
      }),
    );
    expect(error.message).toContain("same map");
    expect(
      requests.some(
        (r) =>
          r.method === "POST" && r.path === "/repos/acme/widgets/issues/5/dependencies/blocked_by",
      ),
    ).toBe(false);
  });

  test("rejects retaining a foreign dependency rather than persisting or deleting it", async () => {
    const current = stepIssue(5, { name: "alpha", description: "first" });
    const { record, requests } = recorder();
    const step: StepRecord = {
      format_version: 4,
      id: 5,
      name: "alpha",
      type: "research",
      description: "first",
      status: "pending",
      dependencies: [99],
      inputs: [],
      outputs: [],
      required_inputs: [],
      required_outputs: [],
      body: "",
      created_at: ISSUE_TIME,
      updated_at: ISSUE_TIME,
    };
    const error = await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, [issueJson(99, { id: 1099 })]);
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* Effect.flip(store.saveStep(mapHandle(), step));
      }),
    );
    expect(error.message).toContain("same map");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  test("a description and body update rewrites the title and body without a state edit", async () => {
    const current = stepIssue(5, { name: "alpha", description: "old", body: "old prose" });
    const { record, requests } = recorder();
    await runGithubMapStore(
      (request) => {
        record(request);
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path.endsWith("/issues/7/sub_issues"))
          return jsonResponse(200, [current]);
        if (
          request.method === "GET" &&
          path === "/repos/acme/widgets/issues/5/dependencies/blocked_by"
        )
          return jsonResponse(200, []);
        if (request.method === "GET" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, current);
        if (request.method === "PATCH" && path === "/repos/acme/widgets/issues/5")
          return jsonResponse(200, {});
        throw new Error(`unexpected ${request.method} ${request.url}`);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const step = yield* loadStep();
        yield* store.saveStep(mapHandle(), {
          ...step,
          description: "new",
          body: "new prose",
        });
      }),
    );
    const patches = requests.filter((r) => r.method === "PATCH").map((r) => r.body as object);
    expect(patches).toHaveLength(1);
    const patch = patches[0] as { title: string; body: string };
    expect(patch.title).toBe("new");
    expect(patch.body).toContain("new prose");
    expect(patch.body).toContain("name: alpha");
    expect(patch).not.toHaveProperty("state");
  });
});
