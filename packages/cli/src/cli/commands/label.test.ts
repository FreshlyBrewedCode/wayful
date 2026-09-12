import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { expectCommandError, makeCliHarness } from "@test/support/cli-harness";

const { temporaryDirectory, invoke, projectFixture } = makeCliHarness();
const T = "2024-01-01T00:00:00.000Z";

async function githubProject() {
  const project = await temporaryDirectory();
  await mkdir(join(project, ".wayful", "types"), { recursive: true });
  await writeFile(
    join(project, ".wayful", "project.toml"),
    `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "GitHub project"\nbackend = "github"\nrepo = "acme/widgets"\ncreated_at = "${T}"\nupdated_at = "${T}"\n`,
  );
  await writeFile(
    join(project, ".wayful", "types", "task.md"),
    `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nname: task\ndescription: Fixture type\nrequired_inputs: []\nrequired_outputs: []\n---\n`,
  );
  return project;
}

// A `gh`/`git` config sandbox so `gh auth token` can never pick up the
// developer's real credentials; the missing-credentials path is then
// deterministic regardless of the machine.
async function unauthenticated() {
  const sandbox = await temporaryDirectory("wayful-gh-sandbox-");
  await mkdir(join(sandbox, "config"), { recursive: true });
  return {
    WAYFUL_GITHUB_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    HOME: sandbox,
    XDG_CONFIG_HOME: join(sandbox, "config"),
  };
}

describe("label sync", () => {
  test("requires the github backend", async () => {
    const project = await projectFixture();
    const result = invoke(["label", "sync"], project);
    expectCommandError(result);
    expect(result.stderr).toContain("label sync requires the github backend.");
  });

  test("routes to GitHub rather than the filesystem", async () => {
    const project = await githubProject();
    const result = invoke(["label", "sync"], project, await unauthenticated());
    expectCommandError(result);
    expect(result.stderr).toContain("run 'gh auth login', or set GH_TOKEN");
  });
});
