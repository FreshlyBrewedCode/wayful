import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { encodeGoalBody } from "@backend/github/goal";
import { encodeIssueBody } from "@backend/github/issue";
import { mapIssueData } from "@backend/github/map";
import { stepIssueData } from "@backend/github/step";
import { MapStore, type MapHandle } from "@backend/MapStore";
import type { ProjectHandle } from "@backend/ProjectStore";
import {
  CURRENT_FORMAT_VERSION,
  type MapMetadata,
  type NewStepRecord,
  type TypeDefinition,
} from "@domain/model";
import { ISSUE_TIME, graphqlIssue, graphqlIssueResponse } from "@test/support/github/issues";
import { runGithubMapStore } from "@test/support/github/store";

const project: ProjectHandle = {
  root: "/repo",
  description: "",
  backend: "github",
  repo: "acme/widgets",
};

const metadata: MapMetadata = {
  format_version: CURRENT_FORMAT_VERSION,
  name: "plan",
  start: "here",
  allowed_step_types: undefined,
  created_at: ISSUE_TIME,
  updated_at: ISSUE_TIME,
};

const map: MapHandle = { project, name: "plan", metadata, number: 10 };

const taskType: TypeDefinition = {
  format_version: CURRENT_FORMAT_VERSION,
  name: "task",
  description: "A general-purpose work step.",
  required_inputs: [],
  required_outputs: [],
  instructions: "",
};

function newStep(overrides: Partial<NewStepRecord> & Pick<NewStepRecord, "name">): NewStepRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    type: "task",
    description: "A step",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [],
    required_outputs: [],
    body: "",
    ...overrides,
  };
}

const setupStep = newStep({ name: "setup", description: "Set up" });
const workStep = newStep({
  name: "work",
  description: "Do the work",
  dependencies: [12],
  outputs: [{ kind: "document", ref: "file:docs/spec.md" }],
});

const initialGoal = {
  name: "initial-goal",
  outputs: [],
  required_outputs: [{ name: "evidence", kind: "artifact" }] as const,
  body: "",
};

function stepNode(step: NewStepRecord, number: number, dependencies: readonly number[]) {
  return {
    ...graphqlIssue(number, {
      title: step.description,
      body: encodeIssueBody(step.body, stepIssueData(step)),
      labels: { nodes: [{ name: "wayful:step" }, { name: `wayful:type/${step.type}` }] },
    }),
    blockedBy: { nodes: dependencies.map((dependency) => ({ number: dependency })) },
  };
}

const mapGraphqlIssue = {
  ...graphqlIssue(10, { title: "here", body: encodeIssueBody("", mapIssueData("plan")) }),
  subIssues: {
    nodes: [
      stepNode(setupStep, 12, []),
      stepNode(workStep, 11, [12]),
      graphqlIssue(13, {
        title: "initial goal",
        body: encodeGoalBody({
          ...initialGoal,
          required_outputs: [...initialGoal.required_outputs],
        }),
        labels: { nodes: [{ name: "wayful:goal" }] },
      }),
    ],
  },
};

describe("GithubMapStore: snapshot", () => {
  test("assembles the map, steps, goals, artifacts and types from one GraphQL query", async () => {
    const requested: string[] = [];
    const result = await runGithubMapStore(
      (request) => {
        requested.push(request.url);
        return graphqlIssueResponse(mapGraphqlIssue);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.snapshot(map);
      }),
      { types: [taskType] },
    );

    // One GraphQL query, and no REST sub-issue or dependency read whatsoever.
    expect(requested).toEqual(["https://api.github.com/graphql"]);
    expect(result.errors).toEqual([]);
    expect(result.snapshot.map).toEqual(metadata);
    expect(result.snapshot.steps.map((step) => step.id)).toEqual([11, 12]);
    expect(result.snapshot.steps.find((step) => step.id === 11)?.dependencies).toEqual([12]);
    expect(result.snapshot.goals.map((goal) => goal.name)).toEqual(["initial-goal"]);
    expect(result.snapshot.types).toEqual([taskType]);
    expect(result.snapshot.artifacts).toEqual([{ ref: "file:docs/spec.md", kind: "document" }]);
  });

  test("memoizes the snapshot so one command reading the same map twice fetches once", async () => {
    let calls = 0;
    const result = await runGithubMapStore(
      () => {
        calls += 1;
        return graphqlIssueResponse(mapGraphqlIssue);
      },
      Effect.gen(function* () {
        const store = yield* MapStore;
        const first = yield* store.snapshot(map);
        const second = yield* store.snapshot(map);
        return { first, second };
      }),
      { types: [taskType] },
    );

    expect(calls).toBe(1);
    expect(result.first.snapshot.steps).toEqual(result.second.snapshot.steps);
  });

  test("collects a malformed step as a decode error without hiding its siblings", async () => {
    const result = await runGithubMapStore(
      () =>
        graphqlIssueResponse({
          ...mapGraphqlIssue,
          subIssues: {
            nodes: [
              graphqlIssue(14, {
                title: "broken",
                body: "no details block",
                labels: { nodes: [{ name: "wayful:step" }, { name: "wayful:type/task" }] },
              }),
            ],
          },
        }),
      Effect.gen(function* () {
        const store = yield* MapStore;
        return yield* store.snapshot(map);
      }),
      { types: [taskType] },
    );
    expect(result.snapshot.steps).toEqual([]);
    expect(result.errors.map((error) => error.file)).toEqual(["#14"]);
  });
});
