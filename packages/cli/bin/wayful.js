#!/usr/bin/env node
"use strict";

// The published launcher for `wayful`. Dependency-free, plain Node — it has
// to run under whatever `npx`/`bunx` invokes, before any of this package's
// own dependencies are guaranteed available. Its only job is finding the
// right platform binary and getting out of the way: reject a platform that
// isn't shipped, resolve the optional dependency that carries the compiled
// `wayful` binary for this `os`/`arch`, re-exec it with the same stdio, and
// propagate exactly what it did — exit code or terminating signal.

const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(`wayful: ${message}`);
  process.exit(1);
}

if (process.platform === "win32") {
  fail("Windows is not yet supported.");
}

// glibc always exposes its runtime version through `process.report`; musl
// (Alpine and friends) does not. There is no direct "is this musl" check, so
// the absence of the field is read as the signal — but only on Linux. Node
// fills that field from a `dlsym` lookup of `gnu_get_libc_version`, which
// resolves under no non-glibc libc at all, so testing it unconditionally
// rejected every macOS machine (no glibc there by design) as an Alpine box.
if (process.platform === "linux") {
  const glibcVersion = process.report?.getReport?.()?.header?.glibcVersionRuntime;
  if (!glibcVersion) {
    fail(
      "Alpine and other musl systems are not yet supported; run under Bun directly, or use a glibc-based image.",
    );
  }
}

const platformPackage = `@wayful/cli-${process.platform}-${process.arch}`;

let binaryPath;
try {
  binaryPath = require.resolve(`${platformPackage}/bin/wayful`);
} catch {
  fail(
    `the optional dependency ${platformPackage} was not installed — check for --no-optional or a lockfile from another platform, and reinstall.`,
  );
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) fail(`could not run ${binaryPath}: ${result.error.message}`);

// `wayful serve`/`wayful ui` are long-lived; a caller that Ctrl-C's this
// process needs the same signal to reach it back, not a swallowed exit code —
// re-raising it on ourselves is what makes a wrapping shell see the same
// termination its own signal handling expects.
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
