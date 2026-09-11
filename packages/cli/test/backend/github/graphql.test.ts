import { describe, expect, test } from "bun:test";
import { Effect, Redacted } from "effect";
import type { HttpClientRequest } from "effect/unstable/http";

import { readMapSnapshot } from "../../../src/backend/github/graphql";
import type { GitRemoteRef } from "../../../src/backend/github/remote";
import { runGithub } from "./support/store";
import { graphqlIssue, graphqlIssueResponse, jsonResponse, bodyText } from "./support/issues";

const repo: GitRemoteRef = { host: "github.com", owner: "acme", repo: "widgets" };
const token = Redacted.make("test-token");

describe("readMapSnapshot", () => {
  test("issues one POST to the graphql host and normalizes the map and its children", async () => {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const result = await runGithub(
      (request) => {
        seen = request;
        return graphqlIssueResponse({
          ...graphqlIssue(10, { title: "here", stateReason: null }),
          subIssues: {
            nodes: [
              {
                ...graphqlIssue(11, {
                  state: "CLOSED",
                  stateReason: "COMPLETED",
                  closedAt: "2024-02-01T00:00:00Z",
                  labels: { nodes: [{ name: "wayful:step" }] },
                }),
                blockedBy: { nodes: [{ number: 12 }] },
              },
            ],
          },
        });
      },
      readMapSnapshot(repo, token, 10),
    );

    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("https://api.github.com/graphql");
    const payload = JSON.parse(bodyText(seen!)) as { query: string; variables: unknown };
    expect(payload.query).toContain("subIssues");
    expect(payload.query).toContain("blockedBy");
    expect(payload.variables).toEqual({ owner: "acme", repo: "widgets", number: 10 });

    expect(result.map).toEqual({
      id: 1010,
      number: 10,
      title: "here",
      body: "body",
      state: "open",
      state_reason: null,
      labels: ["wayful:map"],
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
      closed_at: null,
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.issue.number).toBe(11);
    expect(result.children[0]?.issue.state_reason).toBe("completed");
    expect(result.children[0]?.issue.closed_at).toBe("2024-02-01T00:00:00.000Z");
    expect(result.children[0]?.dependencies).toEqual([12]);
  });

  test("fails with the graphql message when the query reports errors", async () => {
    const error = await runGithub(
      () => jsonResponse(200, { data: null, errors: [{ message: "Field 'nope' doesn't exist" }] }),
      Effect.flip(readMapSnapshot(repo, token, 10)),
    );
    expect(error.message).toContain("Field 'nope' doesn't exist");
  });

  test("fails clearly when the map does not exist", async () => {
    const error = await runGithub(
      () => jsonResponse(200, { data: { repository: { issue: null } } }),
      Effect.flip(readMapSnapshot(repo, token, 10)),
    );
    expect(error.message).toContain("map #10 was not found");
  });

  test("fails clearly on a non-2xx response", async () => {
    const error = await runGithub(
      () => jsonResponse(500, { message: "server error" }),
      Effect.flip(readMapSnapshot(repo, token, 10)),
    );
    expect(error.message).toContain("graphql snapshot failed with status 500");
  });
});
