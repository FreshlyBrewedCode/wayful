import { describe, expect, test } from "bun:test";
import { Option } from "effect";

import { rateLimitLine } from "@cli/commands/doctor";
import { makeCliHarness } from "@test/support/cli-harness";

const { invoke, projectFixture } = makeCliHarness();

describe("wayful doctor", () => {
  test("reports a filesystem project without failing for absent GitHub configuration", async () => {
    const project = await projectFixture();
    const result = invoke(["doctor"], project);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Project: ${project}`);
    expect(result.stdout).toContain("Backend: filesystem");
    expect(result.stdout).toContain("GitHub: not applicable (filesystem backend)");
  });
});

describe("rateLimitLine", () => {
  test("renders the budget with its reset time", () => {
    const line = rateLimitLine(
      Option.some({ limit: 5000, remaining: 12, reset: 1700000000, resource: "core" }),
    );
    expect(line).toBe(
      `Rate limit: 12/5000 core remaining (resets at ${new Date(1700000000 * 1000).toISOString()})`,
    );
  });

  test("says so when the access check reported no budget", () => {
    expect(rateLimitLine(Option.none())).toBe("Rate limit: not reported by the access check");
  });
});
