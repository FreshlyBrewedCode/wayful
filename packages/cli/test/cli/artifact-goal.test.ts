import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import {
  FIXTURE_TIME,
  breakStep,
  expectCommandError,
  fetchJson,
  makeCliHarness,
} from "../support/cli-harness";

const {
  temporaryDirectory,
  invoke,
  serveInBackground,
  projectFixture,
  writeStep,
  writeStepFixture,
} = makeCliHarness();

describe("artifacts, goals, and validation", () => {
  test("creates, preserves, and shows optional goal bodies", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        [
          "goal",
          "add",
          "--map",
          "plan",
          "--name",
          "release",
          "--description",
          "Approved",
          "--required-outputs",
          '[{"name":"evidence","kind":"artifact"}]',
          "--body",
          "Acceptance details.\nSecond line.",
        ],
        project,
      ).exitCode,
    ).toBe(0);

    const listed = invoke(["goal", "list", "--map", "plan", "--json"], project);
    expect(JSON.parse(listed.stdout)[0].body).toBe("Acceptance details.\nSecond line.");
    expect(invoke(["goal", "list", "--map", "plan"], project).stdout).toContain(
      "Acceptance details.\n  Second line.",
    );

    expect(
      invoke(
        ["goal", "output", "--map", "plan", "--goal", "release", "git:abc", "--slot", "evidence"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(["goal", "satisfy", "--map", "plan", "--goal", "release"], project).exitCode,
    ).toBe(0);
    const map = invoke(["map", "show", "--map", "plan", "--json"], project);
    expect(JSON.parse(map.stdout).goals[0].body).toBe("Acceptance details.\nSecond line.");
    expect(invoke(["map", "show", "--map", "plan"], project).stdout).toContain(
      "Acceptance details.\n    Second line.",
    );
    expect(
      await readFile(join(project, ".wayful", "maps", "plan", "goals", "release.md"), "utf8"),
    ).toContain("Acceptance details.\nSecond line.");
  });

  test("accepts a sigil'd '#name' step reference at every migrated slot", async () => {
    const project = await projectFixture();
    await writeStep(project, "alpha", 1);
    await writeStep(project, "beta", 2);
    await writeStep(project, "gamma", 3);

    expect(invoke(["step", "show", "#alpha", "--map", "plan", "--json"], project).exitCode).toBe(0);
    expect(
      invoke(
        ["step", "update", "#alpha", "--map", "plan", "--description", "Updated via sigil"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(["step", "block", "#gamma", "--map", "plan", "--reason", "Waiting"], project).exitCode,
    ).toBe(0);
    expect(invoke(["step", "unblock", "#gamma", "--map", "plan"], project).exitCode).toBe(0);
    expect(
      invoke(["step", "cancel", "#gamma", "--map", "plan", "--reason", "Not needed"], project)
        .exitCode,
    ).toBe(0);
    expect(
      invoke(["step", "depends", "#alpha", "--map", "plan", "--on", "#beta"], project).exitCode,
    ).toBe(0);

    expect(
      invoke(["step", "output", "#beta", "--map", "plan", "git:sig", "--kind", "document"], project)
        .exitCode,
    ).toBe(0);
    expect(
      invoke(["step", "input", "#alpha", "--map", "plan", "git:sig", "--kind", "document"], project)
        .exitCode,
    ).toBe(0);

    expect(
      invoke(["step", "complete", "#beta", "--map", "plan", "--summary", "Done via sigil"], project)
        .exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["step", "complete", "#alpha", "--map", "plan", "--summary", "Done via sigil too"],
        project,
      ).exitCode,
    ).toBe(0);
  });

  test("attaches refs by explicit matching slots or supplementarily, and gates completion on required output slots", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "work",
      1,
      "required_inputs:\n  - name: brief\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\n",
    );
    expect(
      invoke(["step", "input", "work", "--map", "plan", "git:abc", "--slot", "brief"], project)
        .exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["step", "output", "work", "--map", "plan", "git:extra", "--kind", "document"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["step", "complete", "work", "--map", "plan", "--summary", "Missing required output"],
        project,
      ),
    );
    expect(
      invoke(["step", "output", "work", "--map", "plan", "git:abc", "--slot", "report"], project)
        .exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["step", "complete", "work", "--map", "plan", "--summary", "Evidence recorded"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(["step", "input", "work", "--map", "plan", "git:abc", "--slot", "report"], project),
    );
  });

  test("artifact show prints an artifact's ref and kind, derived from its attachments", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      outputs: [{ ref: "file:docs/brief.md", kind: "document" }],
    });

    const result = invoke(
      ["artifact", "show", "file:docs/brief.md", "--map", "plan", "--json"],
      project,
    );
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);
    expect(view.ref).toBe("file:docs/brief.md");
    expect(view.kind).toBe("document");

    const human = invoke(
      ["artifact", "show", "file:docs/brief.md", "--map", "plan"],
      project,
    ).stdout;
    expect(human).toContain("Ref: file:docs/brief.md");
    expect(human).toContain("Kind: document");

    expectCommandError(
      invoke(["artifact", "show", "file:does-not-exist", "--map", "plan"], project),
    );
  });

  test("artifact list prints every artifact on a map, uncapped, sorted by ref", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "producer",
      outputs: [
        { ref: "file:b", kind: "document" },
        { ref: "file:a", kind: "document" },
      ],
    });

    const result = invoke(["artifact", "list", "--map", "plan", "--json"], project);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { ref: "file:a", kind: "document" },
      { ref: "file:b", kind: "document" },
    ]);

    const human = invoke(["artifact", "list", "--map", "plan"], project).stdout;
    expect(human).toContain("- file:a (document)");
    expect(human).toContain("- file:b (document)");

    const empty = invoke(["artifact", "list", "--map", "plan"], await projectFixture()).stdout;
    expect(empty).toContain("- none");
  });

  test("artifact list and artifact show reject a broken sibling step", async () => {
    const project = await projectFixture();
    await writeStepFixture(project, {
      id: 1,
      name: "good",
      outputs: [{ ref: "file:good", kind: "document" }],
    });
    await writeStepFixture(project, { id: 2, name: "bad" });
    await breakStep(project, "2-bad.md");

    expectCommandError(invoke(["artifact", "list", "--map", "plan"], project));
    expectCommandError(invoke(["artifact", "show", "file:good", "--map", "plan"], project));
  });

  test("adds, lists, and satisfies named goals only once required output slots are fulfilled", async () => {
    const project = await projectFixture();
    expectCommandError(
      invoke(["goal", "add", "--map", "plan", "--description", "Missing name"], project),
    );
    expectCommandError(
      invoke(
        [
          "goal",
          "add",
          "--map",
          "plan",
          "--name",
          "release",
          "--description",
          "Approved",
          "--required-outputs",
          "[]",
        ],
        project,
      ),
    );
    expect(
      invoke(
        [
          "goal",
          "add",
          "--map",
          "plan",
          "--name",
          "release",
          "--description",
          "Approved",
          "--required-outputs",
          '[{"name":"evidence","kind":"artifact"}]',
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(invoke(["goal", "list", "--map", "plan", "--json"], project).exitCode).toBe(0);
    expectCommandError(invoke(["goal", "satisfy", "--map", "plan", "--goal", "release"], project));
    expect(
      invoke(
        ["goal", "output", "--map", "plan", "--goal", "release", "pr:42", "--slot", "evidence"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(["goal", "satisfy", "--map", "plan", "--goal", "release"], project).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["goal", "output", "--map", "plan", "--goal", "release", "pr:43", "--slot", "evidence"],
        project,
      ),
    );
  });

  test("computes sorted actionable next work and validates without mutation using documented exit codes", async () => {
    const project = await projectFixture();
    await writeStep(project, "later", 2);
    await writeStep(project, "first", 1);
    const next = invoke(["map", "next", "--map", "plan", "--json"], project);
    expect(next.exitCode).toBe(0);
    expect(next.stdout.indexOf("first")).toBeLessThan(next.stdout.indexOf("later"));
    const before = await readFile(join(project, ".wayful", "maps", "plan", "map.toml"), "utf8");
    expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
    expect(await readFile(join(project, ".wayful", "maps", "plan", "map.toml"), "utf8")).toBe(
      before,
    );
  });

  test("reports malformed persisted frontmatter as an invalid map rather than modifying it", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "steps", "1-bad.md"),
      "---\nname: bad\n",
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^wayful: /);
  });

  test("reports null attachments, missing slot arrays, and missing lifecycle fields as invalid maps", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "null-attachment",
      1,
      "inputs: [null]\noutputs: []\nrequired_inputs:\n  - name: source\n    kind: document\nrequired_outputs: []\n",
    );
    let result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid inputs attachment");
    expect(result.stderr).not.toContain("unexpected error");

    const stepFile = join(project, ".wayful", "maps", "plan", "steps", "1-null-attachment.md");
    await writeFile(
      stepFile,
      (await readFile(stepFile, "utf8")).replace(
        "required_inputs:\n  - name: source\n    kind: document\n",
        "",
      ),
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("required_inputs must be an array");

    await rm(stepFile);
    await writeStep(
      project,
      "complete-without-summary",
      2,
      "status: complete\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("completion summary is required");
  });

  test("requires cancellation and block reasons in manually authored steps", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "cancelled-without-reason",
      1,
      "status: cancelled\ndependencies: []\ninputs: []\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    let result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cancellation reason is required");
    await writeFile(
      join(project, ".wayful", "maps", "plan", "steps", "1-cancelled-without-reason.md"),
      (
        await readFile(
          join(project, ".wayful", "maps", "plan", "steps", "1-cancelled-without-reason.md"),
          "utf8",
        )
      ).replace("status: cancelled", "status: blocked"),
    );
    result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("block reason is required");
  });

  test("rejects unsupported options and extra positionals before mutations", async () => {
    const project = await projectFixture();
    const mapFile = join(project, ".wayful", "maps", "plan", "map.toml");
    const before = await readFile(mapFile, "utf8");
    for (const args of [
      ["map", "create", "unexpected", "--map", "new", "--start", "here", "--goal", "there"],
      [
        "step",
        "create",
        "new-work",
        "extra",
        "--map",
        "plan",
        "--type",
        "task",
        "--description",
        "Must not write",
      ],
      ["artifact", "show", "file:x", "extra", "--map", "plan"],
      [
        "goal",
        "add",
        "--map",
        "plan",
        "--name",
        "release",
        "--description",
        "Released",
        "--unknown",
        "value",
      ],
      ["init", "unexpected", "--project", join(project, "another")],
    ])
      expectCommandError(invoke(args, project));
    expect(await readFile(mapFile, "utf8")).toBe(before);
    await expect(
      readFile(join(project, ".wayful", "maps", "plan", "steps", "1-new-work.md"), "utf8"),
    ).rejects.toThrow();
    expect(
      invoke(["--project", project, "map", "show", "--map", "plan", "--json"], project).exitCode,
    ).toBe(0);
  });

  test("rejects malformed step attachments", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "work",
      1,
      "inputs:\n  - ref: git:orphan\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has an invalid inputs attachment");
  });

  test("validates manually authored slot attachments in both directions", async () => {
    const project = await projectFixture();
    const stepDirectory = join(project, ".wayful", "maps", "plan", "steps");
    const manualStep = (id: number, name: string, inputs: string) =>
      writeFile(
        join(stepDirectory, `${id}-${name}.md`),
        `---\nformat_version: ${CURRENT_FORMAT_VERSION}\nid: ${id}\nname: ${name}\ntype: task\ndescription: Manually edited\nstatus: pending\ndependencies: []\ninputs:\n${inputs}outputs: []\nrequired_inputs:\n  - name: source\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n---\n`,
      );
    await manualStep(1, "unknown", "  - ref: git:doc\n    slot: absent\n");
    await manualStep(2, "wrong-direction", "  - ref: git:doc\n    slot: report\n");
    await manualStep(
      3,
      "duplicate",
      "  - ref: git:doc\n    slot: source\n  - ref: git:doc2\n    slot: source\n",
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown inputs slot 'absent'");
    expect(result.stderr).toContain("unknown inputs slot 'report'");
    expect(result.stderr).toContain("fulfills inputs slot 'source' more than once");
  });

  test("validates duplicate manually authored dependencies", async () => {
    const project = await projectFixture();
    await writeStep(project, "first", 1);
    await writeStep(project, "second", 4);
    const first = join(project, ".wayful", "maps", "plan", "steps", "1-first.md");
    await writeFile(
      first,
      (await readFile(first, "utf8")).replace("dependencies: []", "dependencies: [4, 4]"),
    );
    const validation = invoke(["map", "validate", "--map", "plan"], project);
    expect(validation.exitCode).toBe(1);
    expect(validation.stderr).toContain("duplicate dependency");
    expectCommandError(
      invoke(
        [
          "step",
          "create",
          "new-work",
          "--map",
          "plan",
          "--type",
          "task",
          "--description",
          "Must not write",
        ],
        project,
      ),
    );
    const entries = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(project, ".wayful", "maps", "plan", "steps")),
    );
    expect(entries.some((entry) => entry.endsWith("-new-work.md"))).toBe(false);
  });

  test("refuses every map mutation when existing map identities are globally invalid", async () => {
    const project = await projectFixture();
    await writeStep(project, "first", 1);
    await writeStep(project, "first", 2);
    const mapDirectory = join(project, ".wayful", "maps", "plan");
    const beforeFirst = await readFile(join(mapDirectory, "steps", "1-first.md"), "utf8");
    const beforeSecond = await readFile(join(mapDirectory, "steps", "2-first.md"), "utf8");
    const beforeMap = await readFile(join(mapDirectory, "map.toml"), "utf8");

    expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
    for (const args of [
      [
        "goal",
        "add",
        "--map",
        "plan",
        "--name",
        "release",
        "--description",
        "Released",
        "--required-outputs",
        '[{"name":"evidence","kind":"artifact"}]',
      ],
      [
        "goal",
        "output",
        "--map",
        "plan",
        "--goal",
        "release",
        "git:existing",
        "--kind",
        "document",
      ],
      ["goal", "satisfy", "--map", "plan", "--goal", "release"],
      [
        "step",
        "create",
        "new-work",
        "--map",
        "plan",
        "--type",
        "task",
        "--description",
        "Must not write",
      ],
      ["step", "update", "first", "--map", "plan", "--description", "Must not update"],
      ["step", "block", "first", "--map", "plan", "--reason", "Must not block"],
      ["step", "unblock", "first", "--map", "plan"],
      ["step", "complete", "first", "--map", "plan", "--summary", "Must not complete"],
      ["step", "cancel", "first", "--map", "plan", "--reason", "Must not cancel"],
      ["step", "depends", "first", "--map", "plan", "--on", "2"],
      ["step", "input", "first", "--map", "plan", "git:existing", "--kind", "document"],
      ["step", "output", "first", "--map", "plan", "git:existing", "--kind", "document"],
    ])
      expectCommandError(invoke(args, project));

    expect(await readFile(join(mapDirectory, "steps", "1-first.md"), "utf8")).toBe(beforeFirst);
    expect(await readFile(join(mapDirectory, "steps", "2-first.md"), "utf8")).toBe(beforeSecond);
    expect(await readFile(join(mapDirectory, "map.toml"), "utf8")).toBe(beforeMap);
    await expect(readFile(join(mapDirectory, "goals", "release.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(mapDirectory, "steps", "3-new-work.md"), "utf8")).rejects.toThrow();
  });

  test("serves the viewer API and the bundled client from the project given by --project", async () => {
    const project = await projectFixture();
    await writeStep(project, "work", 1);
    const elsewhere = await temporaryDirectory();

    // Points `ui` at a minimal client rather than relying on packages/ui
    // having been built — `check` runs before `build` in CI, so neither the
    // embedded map nor a workspace dist/ is guaranteed to exist here.
    const client = await temporaryDirectory();
    await writeFile(join(client, "index.html"), '<!doctype html><div id="root"></div>');

    const ui = await serveInBackground(["ui", "--project", project, "--port", "0"], elsewhere, {
      WAYFUL_UI_DIST: client,
    });
    expect(ui.banner).toContain(project);

    const overview = await fetchJson(ui.url, "/api/overview");
    expect(overview.project.root).toBe(project);
    expect(overview.maps.map((m: { name: string }) => m.name)).toEqual(["plan"]);

    const shell = await fetch(new URL("/maps/plan", ui.url));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('id="root"');
  });

  test("serve exposes the same API without the client", async () => {
    const project = await projectFixture();
    const elsewhere = await temporaryDirectory();

    const api = await serveInBackground(["serve", "--project", project, "--port", "0"], elsewhere);

    const detail = await fetchJson(api.url, "/api/map?name=plan");
    expect(detail.map.name).toBe("plan");
    expect((await fetch(new URL("/", api.url))).status).toBe(404);
  });

  test("renders deterministic human status with goals, counts, blockers, and actionable steps", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        [
          "goal",
          "add",
          "--map",
          "plan",
          "--name",
          "release",
          "--description",
          "Release it",
          "--required-outputs",
          '[{"name":"evidence","kind":"artifact"}]',
        ],
        project,
      ).exitCode,
    ).toBe(0);
    await writeStep(project, "ready", 1);
    await writeStep(project, "waiting", 2);
    const waiting = join(project, ".wayful", "maps", "plan", "steps", "2-waiting.md");
    await writeFile(
      waiting,
      (await readFile(waiting, "utf8")).replace(
        "status: pending",
        "status: blocked\nblock_reason: Awaiting approval",
      ),
    );
    const result = invoke(["map", "status", "--map", "plan"], project);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Map plan",
        "Goals: 0/1 satisfied",
        "Steps: 1 pending, 1 blocked, 0 complete, 0 cancelled",
        "Blockers:",
        "- 2 waiting: Awaiting approval",
        "Actionable steps:",
        "- 1 ready: Original description",
        "",
      ].join("\n"),
    );
  });
});
