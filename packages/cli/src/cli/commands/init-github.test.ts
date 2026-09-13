import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { initializedMessage } from "@cli/commands/init";
import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { expectCommandError, makeCliHarness } from "@test/support/cli-harness";

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

  test("refuses an existing project before touching the remote", async () => {
    const project = await temporaryDirectory();
    await mkdir(join(project, ".wayful"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "project.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "Existing"\nbackend = "filesystem"\ncreated_at = "2024-01-01T00:00:00.000Z"\nupdated_at = "2024-01-01T00:00:00.000Z"\n`,
    );
    const result = invoke(
      ["init", "--backend", "github", "--repo", "acme/widgets"],
      project,
      await unauthenticatedEnvironment(),
    );
    expectCommandError(result);
    expect(result.stderr).toContain("Wayful state already exists");
    // Reaching the remote would have failed on the missing credential instead.
    expect(result.stderr).not.toContain("gh auth login");
  });

  test("refuses from a subdirectory of an existing project", async () => {
    const project = await temporaryDirectory();
    await mkdir(join(project, ".wayful"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "project.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "Existing"\nbackend = "filesystem"\ncreated_at = "2024-01-01T00:00:00.000Z"\nupdated_at = "2024-01-01T00:00:00.000Z"\n`,
    );
    const nested = join(project, "nested");
    await mkdir(nested, { recursive: true });
    const result = invoke(
      ["init", "--backend", "github", "--repo", "acme/widgets"],
      nested,
      await unauthenticatedEnvironment(),
    );
    expectCommandError(result);
    expect(result.stderr).toContain("Wayful state already exists");
    expect(result.stderr).not.toContain("gh auth login");
  });
});

describe("initializedMessage", () => {
  test("names the backend for a filesystem project", () => {
    expect(initializedMessage({ directory: "/work", backend: "filesystem" })).toBe(
      "Initialized Wayful project (backend: filesystem) in /work.",
    );
  });

  test("names the backend, repository, and host for a github project", () => {
    expect(
      initializedMessage({
        directory: "/work",
        backend: "github",
        repo: "acme/widgets",
        host: "github.example.com",
      }),
    ).toBe(
      "Initialized Wayful project (backend: github, repository: acme/widgets, host: github.example.com) in /work.",
    );
  });
});
