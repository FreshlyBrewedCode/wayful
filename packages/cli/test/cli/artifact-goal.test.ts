import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "../../src/domain/model";
import {
  FIXTURE_TIME,
  breakArtifact,
  expectCommandError,
  expectTimestamps,
  fetchJson,
  makeCliHarness,
} from "../support/cli-harness";

const { temporaryDirectory, invoke, serveInBackground, projectFixture, writeStep, writeArtifact } =
  makeCliHarness();

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
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:abc"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "@proof"],
        project,
      ).exitCode,
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

  test("accepts sigil'd '#name' and '@name' forms at every migrated reference slot", async () => {
    // Bare-name forms stay covered by the tests above and below (additivity);
    // this exercises the sigil'd alternative at every slot that accepts the
    // shared reference grammar, so both spellings are proven at each one.
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
      invoke(
        ["artifact", "add", "evidence", "--map", "plan", "--kind", "document", "--ref", "git:sig"],
        project,
      ).exitCode,
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

    expect(
      invoke(
        ["goal", "add", "--map", "plan", "--name", "ship", "--description", "Ship it"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "ship", "--artifact", "@evidence"],
        project,
      ).exitCode,
    ).toBe(0);

    // --evidence is a peer spelling of --artifact, not a replacement; prove it
    // also accepts the sigil'd grammar, on a second goal and artifact.
    expect(
      invoke(
        [
          "artifact",
          "add",
          "evidence-two",
          "--map",
          "plan",
          "--kind",
          "document",
          "--ref",
          "git:2",
        ],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "add", "--map", "plan", "--name", "ship-two", "--description", "Ship it too"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "ship-two", "--evidence", "@evidence-two"],
        project,
      ).exitCode,
    ).toBe(0);
  });

  test("registers opaque artifacts once and attaches them by explicit matching slots or supplementarily", async () => {
    const project = await projectFixture({
      typeSlots:
        "required_inputs:\n  - name: brief\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\n",
    });
    await writeStep(
      project,
      "work",
      1,
      "required_inputs:\n  - name: brief\n    kind: document\nrequired_outputs:\n  - name: report\n    kind: document\n",
    );
    expect(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:abc"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:def"],
        project,
      ),
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

  test("refuses an artifact name already represented by a .yml record", async () => {
    const project = await projectFixture();
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:one\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    expectCommandError(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:two"],
        project,
      ),
    );
    await expect(
      readFile(join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml"), "utf8"),
    ).rejects.toThrow();
  });

  test("versions created artifacts, stamps timestamps, and rejects missing, malformed, or unsupported artifact versions", async () => {
    const project = await projectFixture();
    expect(
      invoke(
        ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:one"],
        project,
      ).exitCode,
    ).toBe(0);
    const artifactFile = join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml");
    const artifactText = await readFile(artifactFile, "utf8");
    expect(artifactText).toContain(`format_version: ${CURRENT_FORMAT_VERSION}`);
    expect(artifactText).toMatch(/created_at: \d{4}-\d{2}-\d{2}T/);
    expect(artifactText).toMatch(/updated_at: \d{4}-\d{2}-\d{2}T/);
    for (const replacement of [
      "",
      "format_version: nope",
      `format_version: ${CURRENT_FORMAT_VERSION + 1}`,
    ]) {
      const original = await readFile(artifactFile, "utf8");
      await writeFile(
        artifactFile,
        original.replace(`format_version: ${CURRENT_FORMAT_VERSION}`, replacement),
      );
      const validation = invoke(["map", "validate", "--map", "plan"], project);
      expect(validation.exitCode).toBe(1);
      // A malformed artifact is a broken sibling, not the map itself: `map
      // show` still renders the healthy records and reports the skip.
      const show = invoke(["map", "show", "--map", "plan", "--json"], project);
      expect(show.exitCode).toBe(0);
      const shown = JSON.parse(show.stdout);
      expect(shown.artifacts).toEqual([]);
      expect(shown.errors).toHaveLength(1);
      expect(shown.errors[0].file).toContain("1-proof.yaml");
      await writeFile(artifactFile, original);
    }
  });

  test("artifact show prints an artifact's full record by reference, accepting the full reference grammar", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "brief", 1, { kind: "document", ref: "docs/brief.md" });
    await mkdir(join(project, ".wayful", "maps", "elsewhere", "steps"), { recursive: true });
    await mkdir(join(project, ".wayful", "maps", "elsewhere", "artifacts"), { recursive: true });
    await mkdir(join(project, ".wayful", "maps", "elsewhere", "goals"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "elsewhere", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "elsewhere"\nstart = "here"\nstep_id_counter = 1\nartifact_id_counter = 2\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    await writeArtifact(project, "other-map-doc", 1, {
      map: "elsewhere",
      kind: "document",
      ref: "x",
    });

    for (const args of [
      ["artifact", "show", "@1", "--map", "plan"],
      ["artifact", "show", "@brief", "--map", "plan"],
      ["artifact", "show", "plan/@1"],
      ["artifact", "show", "plan/@brief"],
    ]) {
      const result = invoke([...args, "--json"], project);
      expect(result.exitCode).toBe(0);
      const view = JSON.parse(result.stdout);
      expect(view.id).toBe("plan/@1");
      expect(view.name).toBe("brief");
      expect(view.kind).toBe("document");
      expect(view.ref).toBe("docs/brief.md");
      expectTimestamps(view);
    }

    // A map prefix on the reference overrides --map/WAYFUL_MAP.
    const crossMap = invoke(
      ["artifact", "show", "elsewhere/@1", "--map", "plan", "--json"],
      project,
    );
    expect(crossMap.exitCode).toBe(0);
    expect(JSON.parse(crossMap.stdout).id).toBe("elsewhere/@1");

    const human = invoke(["artifact", "show", "@1", "--map", "plan"], project).stdout;
    expect(human).toContain("plan/@1 brief");
    expect(human).toContain("Kind: document");
    expect(human).toContain("Reference: docs/brief.md");

    expectCommandError(invoke(["artifact", "show", "@does-not-exist", "--map", "plan"], project));
  });

  test("artifact list prints every artifact on a map, uncapped, with fully-qualified ids", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "alpha", 1, { kind: "document", ref: "a" });
    await writeArtifact(project, "beta", 2, { kind: "document", ref: "b" });

    const result = invoke(["artifact", "list", "--map", "plan", "--json"], project);
    expect(result.exitCode).toBe(0);
    const list = JSON.parse(result.stdout);
    expect(list.map((a: { id: string; name: string }) => [a.id, a.name])).toEqual([
      ["plan/@1", "alpha"],
      ["plan/@2", "beta"],
    ]);

    const human = invoke(["artifact", "list", "--map", "plan"], project).stdout;
    expect(human).toContain("- plan/@1 alpha (document): a");
    expect(human).toContain("- plan/@2 beta (document): b");

    const empty = invoke(["artifact", "list", "--map", "plan"], await projectFixture()).stdout;
    expect(empty).toContain("- none");
  });

  test("artifact list and artifact show reject a broken sibling and address a malformed artifact as an error", async () => {
    const project = await projectFixture();
    await writeArtifact(project, "good", 1);
    await writeArtifact(project, "bad", 2);
    await breakArtifact(project, "2-bad.yaml");

    expectCommandError(invoke(["artifact", "list", "--map", "plan"], project));
    expectCommandError(invoke(["artifact", "show", "@2", "--map", "plan"], project));
  });

  test("adds, lists, and satisfies named goals only with existing evidence and no re-satisfaction", async () => {
    const project = await projectFixture();
    expectCommandError(
      invoke(["goal", "add", "--map", "plan", "--description", "Missing name"], project),
    );
    expect(
      invoke(
        ["goal", "add", "--map", "plan", "--name", "release", "--description", "Approved"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(invoke(["goal", "list", "--map", "plan", "--json"], project).exitCode).toBe(0);
    expectCommandError(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "@missing"],
        project,
      ),
    );
    expect(
      invoke(
        ["artifact", "add", "approval", "--map", "plan", "--kind", "document", "--ref", "pr:42"],
        project,
      ).exitCode,
    ).toBe(0);
    expect(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "@approval"],
        project,
      ).exitCode,
    ).toBe(0);
    expectCommandError(
      invoke(
        ["goal", "satisfy", "--map", "plan", "--goal", "release", "--artifact", "@approval"],
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
      ["artifact", "add", "proof", "extra", "--map", "plan", "--kind", "document", "--ref", "ref"],
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

  test("rejects malformed step attachments and duplicate YAML artifact identities", async () => {
    const project = await projectFixture();
    await writeStep(
      project,
      "work",
      1,
      "inputs:\n  - ref: git:orphan\noutputs: []\nrequired_inputs: []\nrequired_outputs: []\n",
    );
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:one\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    await writeFile(
      join(project, ".wayful", "maps", "plan", "artifacts", "1-proof.yml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: proof\nkind: document\nref: git:two\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    const result = invoke(["map", "validate", "--map", "plan"], project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has an invalid inputs attachment");
    expect(result.stderr).toContain("duplicate artifact identity");
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
    await writeFile(
      join(mapDirectory, "artifacts", "1-existing.yaml"),
      `format_version: ${CURRENT_FORMAT_VERSION}\nid: 1\nname: existing\nkind: document\nref: git:existing\ncreated_at: ${FIXTURE_TIME}\nupdated_at: ${FIXTURE_TIME}\n`,
    );
    const beforeFirst = await readFile(join(mapDirectory, "steps", "1-first.md"), "utf8");
    const beforeSecond = await readFile(join(mapDirectory, "steps", "2-first.md"), "utf8");
    const beforeMap = await readFile(join(mapDirectory, "map.toml"), "utf8");

    expect(invoke(["map", "validate", "--map", "plan"], project).exitCode).toBe(1);
    for (const args of [
      ["artifact", "add", "proof", "--map", "plan", "--kind", "document", "--ref", "git:one"],
      ["goal", "add", "--map", "plan", "--name", "release", "--description", "Released"],
      ["goal", "satisfy", "--map", "plan", "--goal", "initial-goal", "--artifact", "@existing"],
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
    await expect(
      readFile(join(mapDirectory, "artifacts", "2-proof.yaml"), "utf8"),
    ).rejects.toThrow();
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
        ["goal", "add", "--map", "plan", "--name", "release", "--description", "Release it"],
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
