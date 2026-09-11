import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addSubIssue,
  createIssue,
  getIssue,
  listSubIssues,
  updateIssue,
} from "../../src/backend/github/api";
import { SUB_ISSUE_CAP, subIssueCapError } from "../../src/backend/github/subIssues";
import { MapStore } from "../../src/backend/MapStore";
import {
  CURRENT_FORMAT_VERSION,
  type NewGoalRecord,
  type NewStepRecord,
  type StepRecord,
} from "../../src/domain/model";
import {
  discoverLive,
  ensureLiveLabels,
  LIVE_REPO_ENV,
  poll,
  restoreRepo,
  retryBurst,
  runLive,
  snapshotRepo,
  type LiveTarget,
  type RepoSnapshot,
} from "./support/live-github";

/**
 * The live GitHub backend suite: the same operations the offline suite drives
 * through a stubbed `HttpClient`, but against a real scratch repository and the
 * real GitHub API. It is deliberately not named `*.test.ts`, so `bun check`
 * never discovers it; run it with `bun test:live` and
 * `WAYFUL_LIVE_GITHUB_REPO=owner/name`. The repo is read from the environment:
 * point it at a repository you are happy to have issues created in and deleted
 * from. It skips with a clear reason when the variable or usable credentials
 * are absent.
 *
 * The suite succeeds only if GitHub actually behaves the way the stub was told
 * it does — a stub encoding a wrong assumption about sub-issue creation,
 * `state_reason` handling, dependency edges or the shared cap makes this fail.
 * GitHub's issue reads are eventually consistent, so every read that follows a
 * write goes through `poll`; that is the suite waiting out real propagation
 * delay, not asserting an immediacy the API never promised.
 *
 * Teardown diffs the repository against a snapshot taken before the first test
 * and deletes everything the run added (issues via GraphQL `deleteIssue`, since
 * issues have no REST delete, and labels via REST), so a pass or a failure
 * leaves the scratch repo exactly as it was.
 */
const discovery = await discoverLive();
if (!discovery.target) console.log(`[live-github] skipping live suite: ${discovery.reason}`);
const suite = discovery.target ? describe : describe.skip;

const TASK_TYPE = `---
format_version: ${CURRENT_FORMAT_VERSION}
name: task
description: Live suite type
required_inputs: []
required_outputs: []
---
`;

const uniqueMapName = () =>
  `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function newStep(overrides: Partial<NewStepRecord> = {}): NewStepRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: "alpha",
    type: "task",
    description: "a live step",
    status: "pending",
    dependencies: [],
    inputs: [],
    outputs: [],
    required_inputs: [],
    required_outputs: [],
    body: "live step prose",
    ...overrides,
  };
}

function newGoal(overrides: Partial<NewGoalRecord> = {}): NewGoalRecord {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name: "ship",
    description: "ship it",
    outputs: [],
    required_outputs: [{ name: "evidence", kind: "artifact" }],
    body: "live goal prose",
    ...overrides,
  };
}

function stepById(steps: readonly StepRecord[], id: number): StepRecord {
  const step = steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`step #${id} was not returned by listSteps`);
  return step;
}

/** The record with every status-specific field cleared, so it saves back as pending. */
const asPending = (step: StepRecord): StepRecord => ({
  ...step,
  status: "pending",
  block_reason: undefined,
  completion_summary: undefined,
  cancellation_reason: undefined,
  closed_at: undefined,
});

suite(`live GitHub backend suite against ${process.env[LIVE_REPO_ENV] ?? "a scratch repo"}`, () => {
  const discovered = discovery.target;
  let target!: LiveTarget;
  let projectRoot = "";
  let snapshot: RepoSnapshot | undefined;

  beforeAll(async () => {
    if (discovered === undefined) return;
    projectRoot = await mkdtemp(join(tmpdir(), "wayful-live-github-"));
    await mkdir(join(projectRoot, ".wayful", "types"), { recursive: true });
    await writeFile(join(projectRoot, ".wayful", "types", "task.md"), TASK_TYPE);
    target = { ...discovered, project: { ...discovered.project, root: projectRoot } };
    snapshot = await runLive(
      Effect.gen(function* () {
        // Snapshot before the run creates anything, so its labels and issues
        // are all recognized as this run's and torn down afterwards.
        const before = yield* snapshotRepo(target);
        yield* ensureLiveLabels(target);
        return before;
      }),
    );
  }, 120_000);

  afterAll(async () => {
    try {
      if (snapshot !== undefined) await runLive(restoreRepo(target, snapshot));
    } finally {
      if (projectRoot !== "") await rm(projectRoot, { recursive: true, force: true });
    }
  }, 300_000);

  test("drives a map through its whole lifecycle against the real API", async () => {
    const mapName = uniqueMapName();
    const created = await runLive(
      Effect.gen(function* () {
        const store = yield* MapStore;

        // Create: a map is born with an initial goal sub-issue.
        yield* store.createMap(target.project, {
          name: mapName,
          start: "live suite start",
          goal: "the initial goal",
          goalBody: "goal body prose",
        });
        const map = yield* poll(
          `map '${mapName}' to become visible`,
          store.openMap(target.project, mapName),
          () => true,
        );
        expect(map.number).toBeGreaterThan(0);
        yield* poll("the initial goal to appear", store.listGoals(map), (read) =>
          read.records.some((goal) => goal.name === "initial-goal"),
        );

        // Add a goal whose satisfaction is observable through a required slot.
        yield* store.createGoal(map, newGoal({ name: "ship", description: "users can sign up" }));
        yield* poll("goal 'ship' to appear", store.listGoals(map), (read) =>
          read.records.some((goal) => goal.name === "ship"),
        );

        // Add steps.
        const alpha = yield* store.createStep(
          map,
          newStep({ name: "alpha", description: "first step" }),
        );
        const beta = yield* store.createStep(
          map,
          newStep({ name: "beta", description: "second step" }),
        );
        expect(alpha.id).toBeGreaterThan(0);
        expect(beta.id).toBeGreaterThan(0);
        yield* poll(
          "both steps to appear",
          store.listSteps(map),
          (read) =>
            read.records.some((step) => step.id === alpha.id) &&
            read.records.some((step) => step.id === beta.id),
        );

        // Dependency: add, read it back, then remove it.
        yield* store.saveStep(map, { ...beta, dependencies: [alpha.id] });
        yield* poll("the dependency edge to appear", store.listSteps(map), (read) =>
          stepById(read.records, beta.id).dependencies.includes(alpha.id),
        );
        const linked = stepById((yield* store.listSteps(map)).records, beta.id);
        expect(linked.dependencies).toEqual([alpha.id]);
        yield* store.saveStep(map, { ...linked, dependencies: [] });
        yield* poll(
          "the dependency edge to be removed",
          store.listSteps(map),
          (read) => stepById(read.records, beta.id).dependencies.length === 0,
        );
        expect(stepById((yield* store.listSteps(map)).records, beta.id).dependencies).toEqual([]);

        // Statuses: pending -> blocked -> pending -> complete on alpha, then
        // pending -> cancelled on beta, reading every state back each time.
        let alphaNow = stepById((yield* store.listSteps(map)).records, alpha.id);
        expect(alphaNow.status).toBe("pending");

        yield* store.saveStep(map, {
          ...alphaNow,
          status: "blocked",
          block_reason: "waiting on review",
        });
        alphaNow = stepById(
          (yield* poll(
            "alpha to read back blocked",
            store.listSteps(map),
            (read) => stepById(read.records, alpha.id).status === "blocked",
          )).records,
          alpha.id,
        );
        expect(alphaNow.status).toBe("blocked");
        expect(
          (yield* poll(
            "the blocked label on alpha",
            getIssue(target.ref, target.token, alpha.id),
            (issue) => issue.labels.includes("wayful:blocked"),
          )).labels,
        ).toContain("wayful:blocked");

        yield* store.saveStep(map, asPending(alphaNow));
        alphaNow = stepById(
          (yield* poll(
            "alpha to read back pending",
            store.listSteps(map),
            (read) => stepById(read.records, alpha.id).status === "pending",
          )).records,
          alpha.id,
        );
        expect(alphaNow.status).toBe("pending");
        expect(
          (yield* poll(
            "the blocked label to leave alpha",
            getIssue(target.ref, target.token, alpha.id),
            (issue) => !issue.labels.includes("wayful:blocked"),
          )).labels,
        ).not.toContain("wayful:blocked");

        yield* store.saveStep(map, {
          ...alphaNow,
          status: "complete",
          completion_summary: "shipped",
        });
        yield* poll(
          "alpha to read back complete",
          store.listSteps(map),
          (read) => stepById(read.records, alpha.id).status === "complete",
        );
        const completed = yield* poll(
          "alpha to close as completed",
          getIssue(target.ref, target.token, alpha.id),
          (issue) => issue.state === "closed" && issue.state_reason === "completed",
        );
        expect(completed.state_reason).toBe("completed");

        yield* store.saveStep(map, {
          ...stepById((yield* store.listSteps(map)).records, beta.id),
          status: "cancelled",
          cancellation_reason: "dropped",
        });
        yield* poll(
          "beta to read back cancelled",
          store.listSteps(map),
          (read) => stepById(read.records, beta.id).status === "cancelled",
        );
        const cancelled = yield* poll(
          "beta to close as not_planned",
          getIssue(target.ref, target.token, beta.id),
          (issue) => issue.state === "closed" && issue.state_reason === "not_planned",
        );
        expect(cancelled.state_reason).toBe("not_planned");

        // Satisfy the goal by filling its required output slot.
        const ship = (yield* store.listGoals(map)).records.find((goal) => goal.name === "ship")!;
        expect(ship.outputs).toEqual([]);
        yield* store.saveGoal(map, {
          ...ship,
          outputs: [{ slot: "evidence", ref: "file:docs/evidence.md" }],
        });
        const satisfied = (yield* poll(
          "goal 'ship' to record its output",
          store.listGoals(map),
          (read) => (read.records.find((goal) => goal.name === "ship")?.outputs.length ?? 0) > 0,
        )).records.find((goal) => goal.name === "ship")!;
        expect(satisfied.outputs).toEqual([{ slot: "evidence", ref: "file:docs/evidence.md" }]);
        // The goal closes natively as completed once its slot is filled; find
        // its issue among the map's sub-issues by its description (the title).
        yield* poll(
          "the satisfied goal to close as completed",
          listSubIssues(target.ref, target.token, map.number!),
          (issues) =>
            issues.some(
              (issue) => issue.title === "users can sign up" && issue.state_reason === "completed",
            ),
        );

        return { mapNumber: map.number!, alphaId: alpha.id, betaId: beta.id };
      }),
    );

    // Archive and reopen. Closing the map issue is the archive: it disappears
    // from `listMaps`/`openMap` but its sub-issues persist, so reopening
    // restores the map intact. A fresh run gives fresh, unmemoized reads.
    await runLive(
      Effect.gen(function* () {
        const store = yield* MapStore;
        yield* updateIssue(target.ref, target.token, created.mapNumber, {
          state: "closed",
          state_reason: "completed",
        });
        yield* poll(
          `map '${mapName}' to be archived`,
          store.listMaps(target.project),
          (read) => !read.records.some((map) => map.name === mapName),
        );
        const absent = yield* Effect.flip(store.openMap(target.project, mapName));
        expect(absent.message).toContain("does not exist");

        yield* updateIssue(target.ref, target.token, created.mapNumber, { state: "open" });
        const reopened = yield* poll(
          `map '${mapName}' to reappear`,
          store.openMap(target.project, mapName),
          () => true,
        );
        expect(reopened.number).toBe(created.mapNumber);
        yield* poll(
          "the reopened map's steps to return",
          store.listSteps(reopened),
          (read) => read.records.length === 2,
        );
        yield* poll(
          "the reopened map's goals to return",
          store.listGoals(reopened),
          (read) => read.records.length === 2,
        );
        const { snapshot: restored, errors } = yield* store.snapshot(reopened);
        expect(errors).toEqual([]);
        expect(restored.steps.map((step) => step.id).toSorted((a, b) => a - b)).toEqual(
          [created.alphaId, created.betaId].toSorted((a, b) => a - b),
        );
        expect(restored.goals.map((goal) => goal.name).toSorted()).toEqual(
          ["initial-goal", "ship"].toSorted(),
        );
      }),
    );
  }, 600_000);

  test("the shared 100-sub-issue cap is enforced by the real API", async () => {
    const mapName = uniqueMapName();
    await runLive(
      Effect.gen(function* () {
        const store = yield* MapStore;
        // A map is born with one sub-issue (its initial goal), so the map needs
        // `SUB_ISSUE_CAP - 1` more to sit exactly at the cap.
        yield* store.createMap(target.project, {
          name: mapName,
          start: "cap suite start",
          goal: "cap suite goal",
          goalBody: "",
        });
        const map = yield* poll(
          `map '${mapName}' to become visible`,
          store.openMap(target.project, mapName),
          () => true,
        );
        const parent = map.number!;

        // Fill to the cap with raw sub-issues: this test is about the cap, not
        // about step creation, and pacing keeps GitHub's secondary burst limit
        // from rejecting the run outright.
        for (let index = 0; index < SUB_ISSUE_CAP - 1; index++) {
          yield* retryBurst(
            Effect.gen(function* () {
              const filler = yield* createIssue(target.ref, target.token, {
                title: `cap filler ${index}`,
                body: "cap filler",
                labels: ["wayful:step"],
              });
              yield* addSubIssue(target.ref, target.token, parent, filler.id);
            }),
          );
          yield* Effect.sleep("1000 millis");
        }
        yield* poll(
          `all ${SUB_ISSUE_CAP} sub-issues to be visible`,
          listSubIssues(target.ref, target.token, parent),
          (issues) => issues.length >= SUB_ISSUE_CAP,
          { timeoutMs: 120_000 },
        );

        // The store refuses the 101st with the named cap error, against the real
        // child count it just read.
        const capped = yield* Effect.flip(
          store.createStep(
            map,
            newStep({ name: "overflow", description: "the step past the cap" }),
          ),
        );
        expect(capped.message).toBe(subIssueCapError().message);

        // And GitHub itself rejects linking a 101st sub-issue with 422, which
        // `addSubIssue` must translate to the same named error — the divergence
        // check for the stub's assumption about how the cap is signalled.
        const extra = yield* retryBurst(
          createIssue(target.ref, target.token, {
            title: "cap overflow issue",
            body: "cap overflow",
            labels: ["wayful:step"],
          }),
        );
        const rejected = yield* Effect.flip(
          retryBurst(addSubIssue(target.ref, target.token, parent, extra.id)),
        );
        expect(rejected.message).toBe(subIssueCapError().message);
      }),
    );
  }, 900_000);
});
