# Publish `wayful` to GitHub and npm, with a compiled-binary release pipeline

## Context

Nothing in this repo is published. There is no git remote, no `.github/`, no `LICENSE`, and both
workspace packages are `"private": true`. The goal is a public repo, a CI/CD pipeline driven by
semantic-release, and a CLI installable as `npx wayful` and `bunx wayful` with the viewer client
bundled into every release.

The single fact that shapes everything else: **`packages/cli` cannot run on Node.** It is bound to
Bun at the source level, not by preference —

- `@effect/platform-bun` (`src/main.ts:2`)
- `Bun.YAML.parse` / `Bun.YAML.stringify` and `Bun.TOML` (`src/backend/filesystem/documents.ts`)
- `Bun.serve`, `Bun.file` (`src/server/http.ts`)

`npx` runs Node. So `npx wayful` must end up executing a `bun build --compile` binary, reached
through a pure-Node launcher. That is the whole reason this plan is more than a workflow file.

## Verified groundwork

Checked against the environment and the registry before planning, not assumed:

- **`wayful` and `@wayful/cli` are both unclaimed on npm** (registry returns 404 for each).
- `gh` is authenticated as `FreshlyBrewedCode`; git protocol is **ssh**; token scopes are
  `gist, read:org, repo` — **no `workflow` scope**. Pushing `.github/workflows/*` over ssh is fine;
  an HTTPS/API push of those files would fail until `gh auth refresh -s workflow`.
- The dev shell provides **Bun 1.4.2**, matching the `flake.nix` pin.
- **`packages/ui/dist` is 536 KB.** Small enough that embedding it into every binary costs a user
  ~536 KB, which is what settles the UI-bundling decision below.
- `bin.wayful` currently points at `./src/main.ts` with a `#!/usr/bin/env bun` shebang — works under
  `bun link`, dead under `npx`.
- `VERSION = "0.1.0"` is hardcoded at `src/main.ts:12`, so `wayful --version` will lie unless it is
  injected at build time.
- `effect` and `@effect/platform-bun` are pinned to `4.0.0-rc.112` — **release candidates**.
- `src/server/http.ts:59` already uses `sep` in its path containment check, so it is not
  accidentally Unix-only. Nothing here has ever been run on Windows regardless.
- **`@semantic-release/npm` v13+ supports npm trusted publishing (OIDC)** — no stored token is
  required. Requires npm CLI ≥ 11.5.1 and `id-token: write`.
- **npm policy, effective 2026-09-03:** trusted-publisher configurations created after that date
  default to allowing only `npm stage publish`. Plain `npm publish` is an explicit opt-in checkbox.
  Every configuration created for this project falls into that bucket.

## Published artifacts

Five packages, published in lockstep at one version.

| Package | Contents | `os` / `cpu` |
| --- | --- | --- |
| `wayful` | Pure-Node launcher shim, `skills/wayful/`, README, LICENSE | — |
| `@wayful/cli-linux-x64` | One compiled binary | `linux` / `x64` |
| `@wayful/cli-linux-arm64` | One compiled binary | `linux` / `arm64` |
| `@wayful/cli-darwin-x64` | One compiled binary | `darwin` / `x64` |
| `@wayful/cli-darwin-arm64` | One compiled binary | `darwin` / `arm64` |

`wayful` is unscoped because `npx wayful` is the invocation users should type. It declares the four
platform packages as **`optionalDependencies` pinned to an exact version**; the `os`/`cpu` fields
make npm and Bun install exactly one of them. This is the esbuild/turbo/swc pattern: a user
downloads ~60 MB once, not ~240 MB.

Only `wayful` declares a `bin`. The platform packages deliberately do not — two `bin` entries named
`wayful` would collide in `node_modules/.bin`.

### The published manifests are generated, never the workspace ones

`packages/cli/package.json` and `packages/ui/package.json` **stay `"private": true` permanently**.
The build stages five complete package directories under `packages/cli/dist/npm/`, each with a
generated manifest, and semantic-release publishes those via `pkgRoot`. Accidental publication of a
workspace package becomes structurally impossible rather than a thing to remember.

```
packages/cli/dist/
  ui/                      # built viewer — codegen source, and the dev fallback
  npm/
    wayful/                # launcher: package.json, bin/wayful.js, skills/, README.md, LICENSE
    cli-linux-x64/         # package.json, bin/wayful, README.md, LICENSE
    cli-linux-arm64/
    cli-darwin-x64/
    cli-darwin-arm64/
```

Each generated manifest carries a `files` **allowlist** (not `.npmignore` — allowlists fail closed),
`license: "MIT"`, and a `repository` block whose `url` matches the GitHub remote character for
character, with `directory` set on the four platform packages. The URL match is not cosmetic: npm
rejects an OIDC publish with an opaque 422 when it disagrees with the OIDC token.

`prototypes/` is a workspace member and throwaway; it is excluded by never appearing in any
allowlist.

## Target platforms, and the two we are not shipping

Four targets: `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`.

**Windows is not shipped.** It was in scope while the release was gated on a native smoke test; with
that gate dropped (see below) a `win32-x64` package would be a binary for a platform that has never
executed a line of this code, on a stack — Bun + Effect 4 RC + `Bun.serve` + `@effect/platform-bun`
— that cannot be reproduced locally. Adding a platform later is a non-event; unshipping one after
people depend on it is a breaking change.

**musl/Alpine is not shipped.** Selecting a musl variant relies on the `libc` manifest field, which
is well supported in npm ≥ 10.4 but shakier in Bun's own installer — awkward when the audience skews
Bun.

Both gaps are handled in the shim, which detects them and fails with an actionable message rather
than letting the loader produce something cryptic:

- `process.platform === "win32"` → "Windows is not yet supported."
- musl detected via absence of `process.report.getReport().header.glibcVersionRuntime` → "Alpine and
  other musl systems are not yet supported; run under Bun directly, or use a glibc-based image."

A good error beats a bad binary.

## The launcher shim

`bin/wayful.js` is dependency-free Node, and does exactly four things:

1. Reject unsupported platforms with the messages above.
2. `require.resolve` the binary inside `@wayful/cli-${process.platform}-${process.arch}`. A failure
   here means the optional dependency was skipped — usually `--no-optional` or a lockfile from
   another platform — so it says that, rather than "module not found".
3. Re-exec the binary with `stdio: "inherit"`, forwarding `process.argv.slice(2)`.
4. Propagate the child's exit code, and its terminating signal — `wayful serve` and `wayful ui` are
   long-lived, so a swallowed `SIGINT` would be a daily annoyance.

## The viewer client is embedded in each binary

At 536 KB the size argument for shipping the client as loose files evaporates, so the binary becomes
self-contained: it works when downloaded raw from a GitHub Release, needs no environment plumbing,
and is not coupled to the shim.

`scripts/bundle-ui.ts` grows a codegen step. After building `packages/ui`, it emits
`src/server/embedded-ui.ts` — one `import … with { type: "file" }` per file in `dist/`, plus a
route → path map — which `bun build --compile` embeds.

`asset()` in `src/server/http.ts:55` then becomes a **map lookup** instead of `resolve()` plus a
containment check. That is a simplification and a security improvement at once: path traversal stops
being something the code defends against and becomes something it cannot express. The `%2e%2e`
decoding logic goes away with it.

`clientDirectory()` in `src/server/client.ts` keeps its fallback chain for development —
`WAYFUL_UI_DIST` → workspace `packages/ui/dist` — with the embedded copy as the built-in default, so
`bun packages/cli/src/main.ts ui` still works from a checkout with no build step.

The `VERSION` hardcode is resolved in the same pass: the version semantic-release computed is
injected with `bun build --define`, and `src/main.ts` reads it instead of a literal.

## CI/CD

Two workflows. **`.github/workflows/release.yml` can never be renamed** — npm pins the trusted
publisher to the exact org/repo/workflow-filename triple, and a rename silently breaks publishing.

### `ci.yml` — on `pull_request` and `push: main`

`bun install --frozen-lockfile`, then `bun run check` (oxfmt, oxlint, `tsc --noEmit`, `bun test`
across packages), then a full build of all four binaries. Building on PRs is what catches a compile
failure before it reaches the release job.

### `release.yml` — on `push: main`

Runs in a GitHub Environment named **`release`** with `permissions: { contents: write, id-token:
write }`. The environment has no required reviewers — it exists to narrow the OIDC subject npm will
trust, not to gate every release behind a click.

The job needs **both runtimes**: Bun 1.4.2 to build, and Node with **npm ≥ 11.5.1** because
`@semantic-release/npm` shells out to `npm`. An older npm silently falls back to token auth and
fails with an authentication error that does not mention OIDC.

Binaries are **cross-compiled for all four targets on a single `ubuntu-latest` runner** —
`bun build --compile --target=` supports this — with no native smoke-test matrix. The one free check
is included: the runner executes the `linux-x64` binary it just built (`wayful --version`, plus
`wayful init` and a bound-and-curled `wayful serve` in a temp directory), because that costs no
extra job.

**Accepted risk, stated plainly: the three non-Linux binaries reach npm having never been
executed.** `darwin-arm64` is likely the largest user segment. This was a deliberate trade for
pipeline simplicity, and it is the first thing to revisit if platform-specific bug reports appear.

### semantic-release configuration

Root-level, single version line, tags `vX.Y.Z`. Plugins in order:

1. `@semantic-release/commit-analyzer` — `conventionalcommits` preset, with a **`releaseRules`
   override mapping breaking changes to a minor bump**. Without it, semantic-release promotes the
   first `BREAKING CHANGE` from `0.x` straight to `1.0.0`, which is exactly the 0.x escape hatch
   this project wants to keep. The override is removed when 1.0.0 is a deliberate choice.
2. `@semantic-release/release-notes-generator`.
3. `@semantic-release/exec` — `prepare`: stamp the version into all five generated manifests, pin
   the launcher's `optionalDependencies` to that exact version, build the UI, run the codegen, and
   compile the four binaries with the version defined in.
4. `@semantic-release/npm` × 5, one per `pkgRoot`. **The four platform packages publish before the
   launcher**, so a launcher on the registry never references versions that do not yet exist.
5. `@semantic-release/github` — creates the release and attaches the four binaries plus a
   `SHA256SUMS` file, giving a `curl`-able artifact and a future target for a Homebrew tap.

`@semantic-release/git` is deliberately **not used**. Committing a changelog back to `main` from CI
means a bot push through branch protection and a real risk of release loops; the changelog lives in
the GitHub Release body, which is where people read it.

## npm authentication: no stored token, ever

Publishing uses **trusted publishing over OIDC**. No `NPM_TOKEN` secret is created at any point, and
provenance attestations are generated automatically — the `--provenance` flag is unnecessary.

Five trusted-publisher configurations, one per package, each specifying owner `FreshlyBrewedCode`,
repository `wayful`, workflow `release.yml`, environment `release`, and — because of the 2026-09-03
policy change — **the `npm publish` allowed-action checkbox explicitly ticked**. npm does not
validate this form on save, so a mistake surfaces later as an opaque 404 or 422.

OIDC removes the exfiltratable secret but not an attacker who compromises the repository itself: the
token is still minted for the legitimate workflow. Branch protection on `main` is part of the
control, not separate from it.

## The one-time bootstrap, as an interactive script

npm requires a package to **exist** before a trusted publisher can be attached to it, but with no
token in CI, CI cannot make that first publish. Someone has to break the cycle by hand — five times.

Rather than a checklist in a README that rots, this ships as **`scripts/bootstrap-release.sh`**: a
single interactive, **idempotent** script, safe to re-run after a failure part-way through. It
verifies far more than it assumes, and pauses for the steps that genuinely cannot be automated.

**Phase 1 — GitHub.** Verify `gh` is authenticated and warn if the `workflow` scope is missing while
the git protocol is HTTPS. Create the public repository if absent, add the remote, push `main`, set
it as the default branch. Create the `release` environment. Apply branch protection requiring the
`ci` check and squash-merge-only. Tag `v0.1.0` at `main` and push it, establishing the 0.x floor and
ensuring the five existing non-conventional commits are never parsed by semantic-release.

**Phase 2 — npm.** Verify `npm --version` ≥ 11.5.1 and fail loudly if not. Verify `npm whoami`,
prompting for `npm login` if needed. Prompt the operator to create the `@wayful` organisation in a
browser and wait for confirmation — org creation has no CLI path. Then for each of the five
packages: skip it if it already exists on the registry, otherwise publish a minimal `0.0.1` stub
with `--access public`.

**Phase 3 — trusted publishers.** For each package, print the exact field values to enter at
npmjs.com, including the environment name and an explicit reminder about the allowed-action
checkbox, and wait for the operator to confirm before moving to the next. Finish by re-verifying all
five packages resolve on the registry.

The script's output should be legible enough that an operator who has never seen this repo can run
it once and stop thinking about it.

## Branch and commit workflow

`main` only. **Squash-merge exclusively**, so a PR's title becomes the commit message, and
Conventional Commits are enforced in exactly one place: a `pr-title.yml` check. No per-commit hook —
that fights messy work-in-progress for no benefit when only the squash message survives.

No `next` prerelease channel: at `0.x` every release is effectively a prerelease already.

The five existing commits are not conventional. This does not matter, because tagging `v0.1.0` at
current `HEAD` means semantic-release never reads history before that point.

## Repository and licensing

Public repository at `FreshlyBrewedCode/wayful`, existing history pushed as-is, `main` as default.
Publishing a CLI that spawns a binary on a user's machine from a repository nobody can read is a
smell worth avoiding.

**MIT**, with `LICENSE` at the root and `license: "MIT"` in all five generated manifests. Without it
the repository is legally all-rights-reserved and nobody can use it.

`skills/wayful/` — the `SKILL.md` and `step-types/` library that *define* the system — ships inside
the `wayful` package. A CLI for driving agentic work whose skill definition requires cloning the
repository is half a product.

## Out of scope

- An `install.sh`, a Homebrew tap, or any distribution channel beyond npm and GitHub Release assets.
  Both are real maintenance surfaces and there is no demand signal yet.
- Windows and musl packages, per the reasoning above.
- Publishing `@wayful/ui` separately. It is a build input to the CLI, not a product.
- Native smoke tests, per the accepted risk above.
- Migrating off the Effect release candidates. Shipping on `4.0.0-rc.112`, pinned exact, is a
  deliberate choice — blocking the first publish on a stable Effect 4 means an indefinite hold on a
  date this project does not control. The README must say so prominently; this is precisely what the
  `0.x` version floor is for.

## Implementation sequence

1. `LICENSE` (MIT), `README.md` install/usage section, and the 0.x-plus-Effect-RC caveat.
2. Extend `scripts/bundle-ui.ts` with the `embedded-ui.ts` codegen; rewrite `asset()` in
   `src/server/http.ts` as a map lookup and delete the containment check; keep `clientDirectory()`'s
   dev fallbacks. Version injection via `--define` replacing `src/main.ts:12`.
3. `scripts/build-release.ts` — compile the four targets, stage the five package directories under
   `dist/npm/` with generated manifests and `files` allowlists.
4. `bin/wayful.js` launcher, including the Windows and musl guards and signal propagation.
5. `.github/workflows/ci.yml` and `pr-title.yml`.
6. `.releaserc` and `.github/workflows/release.yml`.
7. `scripts/bootstrap-release.sh`.
8. Run the bootstrap script; merge the first conventional commit; watch the first real release.

## Verification

Before anything is pushed:

```sh
nix develop --command bun run check          # lint + typecheck + tests, unchanged
nix develop --command bun run build          # UI build + codegen + four binaries
```

Then, against the built artifacts — the embedded client is the part most likely to break silently:

```sh
cd "$(mktemp -d)"
B=<repo>/packages/cli/dist/npm/cli-linux-x64/bin/wayful
$B --version                                 # the injected version, not 0.1.0
$B init --description "smoke"
$B map create --map plan --start here --goal done
$B ui --project . &                          # served from the embedded client, no dist on disk
curl -sf http://127.0.0.1:7830/ | grep -q '<div id="root"'
curl -sf http://127.0.0.1:7830/assets/       # a hashed asset resolves through the map
curl -s  http://127.0.0.1:7830/../../etc/passwd | grep -q '<div id="root"'   # shell, not the file
```

Then the launcher, in isolation from the workspace:

```sh
cd "$(mktemp -d)" && npm init -y
npm install <repo>/packages/cli/dist/npm/cli-linux-x64
npm install <repo>/packages/cli/dist/npm/wayful
npx wayful --version
ls node_modules/wayful/skills/wayful/SKILL.md    # the skill shipped
```

After the first real release, the checks that only the registry can answer: `npx wayful@latest
--version` from a clean machine, `bunx wayful --version`, exactly one platform package present in
`node_modules`, and the provenance badge visible on npmjs.com.
