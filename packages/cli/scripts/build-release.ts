#!/usr/bin/env bun
// Compiles `wayful` for every shipped target and stages the five npm package
// directories semantic-release publishes from, under `packages/cli/dist/npm/`.
// `packages/cli/package.json` and `packages/ui/package.json` stay `"private":
// true` permanently — only what this script generates here ever reaches the
// registry, so publishing a workspace package by accident is structurally
// impossible rather than a thing to remember.
//
// Usage: bun scripts/build-release.ts [version]
// `version` defaults to "0.0.0-dev", which is what CI's build-verification
// step (every PR, and `push: main`) runs with — proving all four targets
// compile without needing a real version. The release workflow passes the
// real one, computed by semantic-release.

import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DIST_NPM = join(PACKAGE_ROOT, "dist", "npm");

// Matches the GitHub remote character for character — npm rejects an OIDC
// publish with an opaque error when the manifest's `repository.url` disagrees
// with the trusted-publisher's repository.
const REPOSITORY_URL = "git+https://github.com/FreshlyBrewedCode/wayful.git";
const DESCRIPTION =
  "A system for planning, orchestrating and completing agentic work on flexible maps of interdependent steps.";

const VERSION = process.argv[2] ?? "0.0.0-dev";
const SMOKE_TEST = process.argv.includes("--smoke-test");
const SMOKE_TEST_PORT = 17999;

interface Target {
  readonly bunTarget: string;
  readonly packageName: string;
  readonly os: string;
  readonly cpu: string;
}

// Linux and macOS, x64 and arm64. Windows has never executed a line of this
// code and musl's variant selection is shakier in Bun's installer than npm's
// — both fail loudly in bin/wayful.js instead of shipping an untested binary.
const TARGETS: Target[] = [
  { bunTarget: "bun-linux-x64", packageName: "@wayful/cli-linux-x64", os: "linux", cpu: "x64" },
  {
    bunTarget: "bun-linux-arm64",
    packageName: "@wayful/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
  { bunTarget: "bun-darwin-x64", packageName: "@wayful/cli-darwin-x64", os: "darwin", cpu: "x64" },
  {
    bunTarget: "bun-darwin-arm64",
    packageName: "@wayful/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
];

function run(cmd: string[], cwd: string = PACKAGE_ROOT): void {
  const result = Bun.spawnSync({ cmd, cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`wayful: \`${cmd.join(" ")}\` failed.`);
    process.exit(result.exitCode ?? 1);
  }
}

function manifestName(packageName: string): string {
  return packageName.replace("@wayful/", "");
}

/**
 * The one free check: the runner can execute the `linux-x64` binary it just
 * built, so it does — `--version`, `init`, and a bound-and-curled `serve` —
 * before anything gets published. The other three targets reach npm having
 * never run; this is the only signal a broken compile gets before release.
 */
async function smokeTest(binary: string): Promise<void> {
  console.log(`wayful: smoke-testing ${binary}`);
  run([binary, "--version"], REPO_ROOT);

  const project = await mkdtemp(join(tmpdir(), "wayful-smoke-"));
  try {
    run([binary, "init", "--description", "smoke test"], project);

    const server = Bun.spawn({
      cmd: [binary, "serve", "--project", project, "--port", String(SMOKE_TEST_PORT)],
      stdout: "inherit",
      stderr: "inherit",
    });
    try {
      const deadline = Date.now() + 5000;
      let ok = false;
      while (Date.now() < deadline && !ok) {
        ok = await fetch(`http://127.0.0.1:${SMOKE_TEST_PORT}/api/overview`)
          .then((response) => response.ok)
          .catch(() => false);
        if (!ok) await Bun.sleep(100);
      }
      if (!ok) {
        console.error("wayful: smoke test could not reach `wayful serve`.");
        process.exit(1);
      }
    } finally {
      server.kill();
    }
  } finally {
    await rm(project, { force: true, recursive: true });
  }

  console.log("wayful: smoke test passed.");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

console.log(`wayful: building release ${VERSION}`);

// The UI build + embedded-ui.ts codegen; see scripts/bundle-ui.ts.
run(["bun", "run", "build"]);

await rm(DIST_NPM, { force: true, recursive: true });

const checksums: string[] = [];
let linuxX64Binary: string | undefined;

for (const target of TARGETS) {
  const outDir = join(DIST_NPM, manifestName(target.packageName));
  await mkdir(join(outDir, "bin"), { recursive: true });
  const outfile = join(outDir, "bin", "wayful");
  if (target.packageName === "@wayful/cli-linux-x64") linuxX64Binary = outfile;

  console.log(`wayful: compiling ${target.packageName}`);
  run([
    "bun",
    "build",
    "--compile",
    `--target=${target.bunTarget}`,
    "--define",
    `WAYFUL_BUILD_VERSION="${VERSION}"`,
    "src/main.ts",
    "--outfile",
    outfile,
  ]);
  await chmod(outfile, 0o755);

  const assetName = `wayful-${target.os}-${target.cpu}`;
  const digest = createHash("sha256")
    .update(await Bun.file(outfile).bytes())
    .digest("hex");
  checksums.push(`${digest}  ${assetName}`);

  await writeJson(join(outDir, "package.json"), {
    name: target.packageName,
    version: VERSION,
    description: `${DESCRIPTION} (${target.os}/${target.cpu} binary)`,
    os: [target.os],
    cpu: [target.cpu],
    license: "MIT",
    repository: { type: "git", url: REPOSITORY_URL, directory: "packages/cli" },
    files: ["bin/wayful"],
  });
}

if (SMOKE_TEST) {
  if (!linuxX64Binary) throw new Error("wayful: no linux-x64 binary to smoke-test.");
  await smokeTest(linuxX64Binary);
}

console.log("wayful: staging the wayful launcher package");
const launcherDir = join(DIST_NPM, "wayful");
await mkdir(join(launcherDir, "bin"), { recursive: true });
await cp(join(PACKAGE_ROOT, "bin", "wayful.js"), join(launcherDir, "bin", "wayful.js"));
await cp(join(REPO_ROOT, "skills", "wayful"), join(launcherDir, "skills", "wayful"), {
  recursive: true,
});
await cp(join(REPO_ROOT, "README.md"), join(launcherDir, "README.md"));
await cp(join(REPO_ROOT, "LICENSE"), join(launcherDir, "LICENSE"));

await writeJson(join(launcherDir, "package.json"), {
  name: "wayful",
  version: VERSION,
  description: DESCRIPTION,
  bin: { wayful: "bin/wayful.js" },
  license: "MIT",
  repository: { type: "git", url: REPOSITORY_URL },
  files: ["bin", "skills", "README.md", "LICENSE"],
  // Pinned to this exact version, never a range: npm/Bun pick the one entry
  // whose os/cpu match, and a stale range could resolve a platform package
  // built by a different release than the launcher shipping it.
  optionalDependencies: Object.fromEntries(TARGETS.map((target) => [target.packageName, VERSION])),
});

// Outside every pkgRoot, so it's never a candidate for accidental publishing —
// the GitHub release step attaches it as a plain file alongside the binaries.
await Bun.write(join(DIST_NPM, "SHA256SUMS"), `${checksums.join("\n")}\n`);

console.log(`wayful: staged five packages in ${DIST_NPM}`);
