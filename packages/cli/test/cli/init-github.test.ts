import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expectCommandError, makeCliHarness } from "../support/cli-harness";

const { temporaryDirectory, invoke } = makeCliHarness();

// A `gh`/`git` config sandbox: pointing HOME/XDG_CONFIG_HOME here guarantees
// `gh auth token` can't see the developer's real credentials, so the
// missing-credentials path is deterministic regardless of the machine this
// test runs on.
async function unauthenticatedEnvironment() {
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

describe("init --backend github", () => {
  test("rejects --repo unless --backend github is also given", async () => {
    const project = await temporaryDirectory();
    expectCommandError(invoke(["init", "--repo", "acme/widgets"], project));
    expect(invoke(["init", "--repo", "acme/widgets"], project).stderr).toContain(
      "--repo requires --backend github.",
    );
  });

  test("rejects a malformed --repo value", async () => {
    const project = await temporaryDirectory();
    const result = invoke(["init", "--backend", "github", "--repo", "not-a-repo"], project);
    expectCommandError(result);
    expect(result.stderr).toContain('--repo must be in the form "owner/name".');
  });

  test("fails with an exact message when no git remote is found and --repo is omitted", async () => {
    const project = await temporaryDirectory();
    const result = invoke(
      ["init", "--backend", "github"],
      project,
      await unauthenticatedEnvironment(),
    );
    expectCommandError(result);
    expect(result.stderr).toContain("no git remote found; pass --repo owner/name.");
  });

  test("fails with the exact missing-credentials message when no token can be resolved", async () => {
    const project = await temporaryDirectory();
    const result = invoke(
      ["init", "--backend", "github", "--repo", "acme/widgets"],
      project,
      await unauthenticatedEnvironment(),
    );
    expectCommandError(result);
    expect(result.stderr).toContain("run 'gh auth login', or set GH_TOKEN");
  });
});
