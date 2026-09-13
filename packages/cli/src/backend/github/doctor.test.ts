import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";

import { GithubCredentials } from "@backend/github/credentials";
import { diagnoseGithub } from "@backend/github/doctor";
import type { GithubHarnessOptions } from "@test/support/github/store";
import { runGithub } from "@test/support/github/store";
import { jsonResponse } from "@test/support/github/issues";
import type { ProjectHandle } from "@backend/ProjectStore";
import { WayfulError } from "@domain/errors";

function project(overrides: Partial<ProjectHandle> = {}): ProjectHandle {
  return {
    root: "/projects/wayful",
    description: "",
    backend: "github",
    repo: "acme/widgets",
    host: "github.example.com",
    ...overrides,
  };
}

const permissionsResponse = jsonResponse(
  200,
  { permissions: { push: true } },
  {
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1700000000",
    "x-ratelimit-resource": "core",
  },
);

describe("diagnoseGithub", () => {
  test("resolves the repository, host, credential, labels, and rate limit", async () => {
    let requested = "";
    const diagnosis = await runGithub(
      (request) => {
        requested = request.url;
        return permissionsResponse;
      },
      diagnoseGithub(project(), ["task", "research"]),
    );
    expect(requested).toBe("https://github.example.com/api/v3/repos/acme/widgets");
    expect(diagnosis.repository).toBe("acme/widgets");
    expect(diagnosis.host).toBe("github.example.com");
    expect(diagnosis.credential).toBe("GH_TOKEN");
    expect(diagnosis.labels).toEqual([
      "wayful:map",
      "wayful:step",
      "wayful:goal",
      "wayful:blocked",
      "wayful:type/task",
      "wayful:type/research",
    ]);
    expect(Option.getOrThrow(diagnosis.rateLimit)).toEqual({
      limit: 5000,
      remaining: 4999,
      reset: 1700000000,
      resource: "core",
    });
  });

  test("names an unusable credential as the problem", async () => {
    const credentials: GithubCredentials["Service"] = {
      resolve: () =>
        Effect.fail(new WayfulError({ message: "run 'gh auth login', or set GH_TOKEN" })),
      token: () =>
        Effect.fail(new WayfulError({ message: "run 'gh auth login', or set GH_TOKEN" })),
    };
    const options: GithubHarnessOptions = { credentials };
    const error = await runGithub(
      () => jsonResponse(200, { permissions: { push: true } }),
      diagnoseGithub(project(), []).pipe(Effect.flip),
      options,
    );
    expect(error.message).toBe("github credential: run 'gh auth login', or set GH_TOKEN");
  });

  test("names the token when it cannot reach the repository", async () => {
    const error = await runGithub(
      () => jsonResponse(404, { message: "Not Found" }),
      diagnoseGithub(project(), []).pipe(Effect.flip),
    );
    expect(error.message).toContain("github token cannot access acme/widgets");
  });
});
