import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CURRENT_FORMAT_VERSION } from "@domain/model";
import { FIXTURE_TIME, expectCommandError, makeCliHarness } from "@test/support/cli-harness";

const { temporaryDirectory, invoke, projectFixture } = makeCliHarness();

describe("project and context contracts", () => {
  test("provides root and command-group help plus a root version", async () => {
    const project = await temporaryDirectory();
    for (const args of [["--help"], ["map", "--help"], ["step", "--help"], ["--version"]]) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toBe("");
    }
  });

  test("names what was wrong with a usage mistake instead of only requesting help", async () => {
    const project = await temporaryDirectory();
    // Every parse mistake reaches this CLI as one framework `ShowHelp` whose
    // own message is the constant "Help requested"; each case here asserts the
    // underlying diagnosis it carries survives to stderr, including the
    // framework's spelling suggestions.
    const cases: [string[], string[]][] = [
      [
        ["step", "create"],
        ["Missing required argument: name", "'wayful step create --help'"],
      ],
      [
        ["stepp", "create"],
        ['Unknown subcommand "stepp"', "Did you mean this?", "step"],
      ],
      [
        ["map", "creaet", "plan"],
        ['Unknown subcommand "creaet"', "Did you mean this?", "create"],
      ],
      [["step", "show", "work", "--bogus"], ["Unrecognized flag: --bogus"]],
      [["ui", "--port", "abc"], ['Invalid value for flag --port: "abc"']],
      [["map", "create", "plan", "--description", "d"], ["Unrecognized flag: --description"]],
    ];
    for (const [args, expected] of cases) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/^wayful: /);
      expect(result.stderr).not.toContain("Help requested");
      for (const fragment of expected) expect(result.stderr).toContain(fragment);
      // The framework renders full help (~25 lines) to stdout for every
      // `ShowHelp`, mistakes included, with no config knob to suppress it.
      // `helpCapturingFormatter` intercepts it; a stray leading blank line
      // is the accepted cost, so `.trim()` rather than an exact `""`.
      expect(result.stdout.trim()).toBe("");
    }
  }, 10000); // 6 subprocess spawns; a loaded CI runner can outrun the default 5s.

  test("treats a deliberate help or version request as a silent success", async () => {
    const project = await temporaryDirectory();
    for (const args of [[], ["map"], ["--help"], ["step", "create", "--help"], ["--version"]]) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    }
  });

  test("documents each command's required arguments and available flags in help", async () => {
    const project = await temporaryDirectory();
    const cases: [string[], string][] = [
      [["init", "--help"], "--description TEXT"],
      [["map", "create", "--help"], "--goal TEXT"],
      [["map", "create", "--help"], "--goal-body TEXT"],
      [["map", "list", "--help"], "--project DIR"],
      [["map", "validate", "--help"], "--json"],
      [["map", "show", "--help"], "FLAGS"],
      [["map", "next", "--help"], "--map NAME"],
      [["map", "status", "--help"], "--project DIR"],
      [["step", "create", "--help"], "--required-outputs JSON"],
      [["step", "create", "--help"], "--body TEXT"],
      [["step", "show", "--help"], "STEP"],
      [["step", "update", "--help"], "--description TEXT"],
      [["step", "update", "--help"], "--body TEXT"],
      [["step", "block", "--help"], "--reason TEXT"],
      [["step", "unblock", "--help"], "--map NAME"],
      [["step", "complete", "--help"], "--summary TEXT"],
      [["step", "cancel", "--help"], "--reason TEXT"],
      [["step", "depends", "--help"], "--on STEP"],
      [["step", "input", "--help"], "--slot NAME"],
      [["step", "output", "--help"], "ref REF"],
      [["artifact", "show", "--help"], "ref REF"],
      [["artifact", "list", "--help"], "--json"],
      [["goal", "list", "--help"], "--json"],
      [["goal", "add", "--help"], "--description TEXT"],
      [["goal", "add", "--help"], "--body TEXT"],
      [["goal", "add", "--help"], "--required-outputs JSON"],
      [["goal", "output", "--help"], "ref REF"],
      [["goal", "output", "--help"], "--slot NAME"],
      [["goal", "satisfy", "--help"], "--goal NAME"],
      [["type", "list", "--help"], "--project DIR"],
      [["type", "show", "--help"], "ARGUMENTS"],
      [["serve", "--help"], "--port PORT"],
      [["serve", "--help"], "--host ADDR"],
      [["serve", "--help"], "--project DIR"],
      [["ui", "--help"], "--port PORT"],
      [["ui", "--help"], "--host ADDR"],
      [["ui", "--help"], "--project DIR"],
    ];
    for (const [args, expected] of cases) {
      const result = invoke(args, project);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(expected);
      expect(result.stdout).toContain("--help");
    }
  }, 20000); // 33 subprocess spawns; a loaded CI runner can outrun the default 5s.

  test("init creates versioned, timestamped metadata and the generic task type, then refuses overwrite", async () => {
    const project = await temporaryDirectory();
    expect(invoke(["init", "--description", "Refresh the site"], project).exitCode).toBe(0);
    const projectToml = await readFile(join(project, ".wayful", "project.toml"), "utf8");
    expect(projectToml).toContain(`format_version = ${CURRENT_FORMAT_VERSION}`);
    expect(projectToml).toContain('backend = "filesystem"');
    expect(projectToml).toMatch(/created_at = "\d{4}-\d{2}-\d{2}T/);
    expect(projectToml).toMatch(/updated_at = "\d{4}-\d{2}-\d{2}T/);
    expect(await readFile(join(project, ".wayful", "types", "task.md"), "utf8")).toContain(
      "name: task",
    );
    expectCommandError(invoke(["init"], project));
  });

  test("discovers upward, honors WAYFUL_PROJECT, and lets --project override it", async () => {
    const project = await projectFixture();
    const other = await projectFixture({ map: "other" });
    const nested = join(project, "a", "deep", "directory");
    await mkdir(nested, { recursive: true });
    expect(invoke(["map", "show", "--map", "plan", "--json"], nested).exitCode).toBe(0);
    expect(
      invoke(["map", "show", "--map", "other", "--json"], nested, { WAYFUL_PROJECT: other })
        .exitCode,
    ).toBe(0);
    expect(
      invoke(["map", "show", "--project", project, "--map", "plan", "--json"], nested, {
        WAYFUL_PROJECT: other,
      }).exitCode,
    ).toBe(0);
  });

  test("rejects absent, malformed, and newer project metadata plus unsafe identifiers", async () => {
    const absent = await temporaryDirectory();
    expectCommandError(invoke(["map", "show", "--map", "plan"], absent));
    const project = await projectFixture();
    await writeFile(join(project, ".wayful", "project.toml"), "not toml = [");
    expectCommandError(invoke(["type", "list"], project));
    await writeFile(
      join(project, ".wayful", "project.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION + 1}\n`,
    );
    expectCommandError(invoke(["type", "list"], project));
    expectCommandError(
      invoke(["map", "create", "--map", "../unsafe", "--start", "now", "--goal", "done"], project),
    );
  });

  test("strictly validates project metadata while accepting the documented unversioned migration form", async () => {
    const project = await projectFixture();
    const metadata = join(project, ".wayful", "project.toml");
    await writeFile(
      metadata,
      `description = "Legacy project"\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    expect(invoke(["type", "list"], project).exitCode).toBe(0);
    for (const invalid of [
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = 42\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nunknown = true\n`,
      `format_version = "${CURRENT_FORMAT_VERSION}"\ndescription = "ok"\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nbackend = "svn"\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nbackend = "filesystem"\nrepo = "acme/widgets"\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nbackend = "github"\n`,
      `format_version = ${CURRENT_FORMAT_VERSION}\ndescription = "ok"\nbackend = "github"\nrepo = "not-a-repo"\n`,
    ]) {
      await writeFile(metadata, invalid);
      expectCommandError(invoke(["type", "list"], project));
    }
  });

  test("requires explicit map context and gives --map precedence over WAYFUL_MAP", async () => {
    const project = await projectFixture();
    await mkdir(join(project, ".wayful", "maps", "other", "steps"), { recursive: true });
    await writeFile(
      join(project, ".wayful", "maps", "other", "map.toml"),
      `format_version = ${CURRENT_FORMAT_VERSION}\nname = "other"\nstart = "there"\nstep_id_counter = 1\ncreated_at = "${FIXTURE_TIME}"\nupdated_at = "${FIXTURE_TIME}"\n`,
    );
    const missing = invoke(["map", "show"], project);
    expectCommandError(missing);
    expect(missing.stderr).toBe("wayful: map context is required; pass --map or set WAYFUL_MAP.\n");
    expect(
      invoke(["map", "show", "--map", "plan", "--json"], project, { WAYFUL_MAP: "other" }).exitCode,
    ).toBe(0);
  });

  test("emits a structured {error} on stdout for --json failures, not just map validate", async () => {
    const project = await projectFixture();
    const missingMap = invoke(["map", "show", "--json"], project);
    expect(missingMap.exitCode).toBe(2);
    expect(missingMap.stderr).toBe(
      "wayful: map context is required; pass --map or set WAYFUL_MAP.\n",
    );
    expect(JSON.parse(missingMap.stdout)).toEqual({
      error: "map context is required; pass --map or set WAYFUL_MAP.",
    });

    const missingProject = invoke(["type", "list", "--json"], await temporaryDirectory());
    expect(missingProject.exitCode).toBe(2);
    expect(JSON.parse(missingProject.stdout)).toEqual({
      error: missingProject.stderr.replace(/^wayful: /, "").trimEnd(),
    });

    const unknownMap = invoke(["map", "show", "--map", "missing", "--json"], project);
    expect(unknownMap.exitCode).toBe(2);
    expect(JSON.parse(unknownMap.stdout)).toEqual({
      error: unknownMap.stderr.replace(/^wayful: /, "").trimEnd(),
    });
  });

  test("honors the {error} --json contract for parse-stage failures too, not just domain/backend ones", async () => {
    const project = await temporaryDirectory();
    // Parse-stage failures never reach `handle()` — the framework rejects
    // them before a command's own `--json` flag is even parsed — so this is
    // a heuristic scan of the raw argv instead. Cover a missing argument and
    // an unrecognized flag, not just one shape of parse-stage failure.
    const missingArgument = invoke(["step", "show", "--json"], project);
    expect(missingArgument.exitCode).toBe(2);
    expect(missingArgument.stderr).toBe(
      "wayful: Missing required argument: step\nwayful: See 'wayful step show --help'.\n",
    );
    expect(JSON.parse(missingArgument.stdout)).toEqual({
      error: "Missing required argument: step",
    });

    // `ui` takes no `--json` flag of its own; the heuristic scan doesn't
    // care, since the flag isn't parsed at all at this stage.
    const unrecognizedFlag = invoke(["ui", "--port", "abc", "--json"], project);
    expect(unrecognizedFlag.exitCode).toBe(2);
    expect(JSON.parse(unrecognizedFlag.stdout)).toEqual({
      error: "Unrecognized flag: --json in command wayful ui",
    });

    // The `--json=` form is recognized too, and no `--json` at all still
    // gets the plain (non-JSON) contract.
    const equalsForm = invoke(["step", "show", "--json=true"], project);
    expect(equalsForm.exitCode).toBe(2);
    expect(JSON.parse(equalsForm.stdout)).toEqual({ error: "Missing required argument: step" });

    const noJson = invoke(["step", "show"], project);
    expect(noJson.exitCode).toBe(2);
    expect(noJson.stdout.trim()).toBe("");
  });
});
