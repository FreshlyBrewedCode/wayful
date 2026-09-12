import { describe, expect, test } from "bun:test";
import type { HttpClientRequest } from "effect/unstable/http";

import type { ProjectHandle } from "../../../src/backend/ProjectStore";
import { syncLabels } from "../../../src/backend/github/sync";
import { bodyText, jsonResponse } from "./support/issues";
import { runGithub } from "./support/store";

const project: ProjectHandle = {
  root: "/repo",
  description: "",
  backend: "github",
  repo: "acme/widgets",
};

/** Captures every `POST /labels` body and answers with `status`. */
function labelSpy(status: number) {
  const created: { readonly name: string }[] = [];
  const respond = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method !== "POST") throw new Error(`unexpected ${request.method} ${request.url}`);
    created.push(JSON.parse(bodyText(request)) as { readonly name: string });
    return jsonResponse(status, status === 201 ? {} : { message: "already exists" });
  };
  return { created, respond };
}

describe("syncLabels", () => {
  test("creates the base wayful labels plus one per type file, including a hand-added type", async () => {
    const { created, respond } = labelSpy(201);
    const names = await runGithub(respond, syncLabels(project, ["task", "ops"]));
    expect(created.map((label) => label.name)).toEqual([
      "wayful:map",
      "wayful:step",
      "wayful:goal",
      "wayful:blocked",
      "wayful:type/task",
      "wayful:type/ops",
    ]);
    expect(names).toContain("wayful:type/ops");
  });

  test("is re-runnable: an existing label's 422 is treated as success", async () => {
    const { respond } = labelSpy(422);
    const names = await runGithub(respond, syncLabels(project, ["task"]));
    expect(names).toContain("wayful:type/task");
  });
});
