# Rebuild `packages/cli` on Effect, behind a backend service seam

## Context

`packages/cli` is the promoted Wayful prototype: a zero-dependency Bun CLI (`src/core.ts`,
`src/model.ts`, `src/commands.ts`, `src/commands/*`). It works, but two things are wrong with its
shape:

1. **Hand-rolled plumbing.** `core.ts` holds a bespoke argv parser, a hand-maintained
   `commandOptions` contract table, and ~200 lines of hand-written help strings that must be kept in
   sync with the parser by eye. `fail()` throws untyped `CliError`s that callers discriminate by
   string matching.
2. **The filesystem is hardcoded.** `model.ts` reaches for `node:fs` directly and threads absolute
   `path` fields through domain records — `saveStep` writes to a `path` smuggled inside the record.
   There is no seam where another persistence backend could be substituted, even though the SPEC's
   own layering decision (`SPEC.md:118`) claims one exists.

This rebuild replaces the CLI plumbing with Effect's CLI module and introduces a real
`WayfulBackend` service, with the current filesystem behaviour as its first implementation. Domain
rules (validation, graph integrity, status) move into a pure layer that neither knows nor cares
where records are stored.

The CLI and `packages/ui/server.ts` are both prototypes, so breaking changes are acceptable where
Effect's defaults or capabilities are better. `--json` output remains a hard requirement; its shape
may change when there is a reason. The existing 40-test suite in `packages/cli/test/wayful.test.ts`
is the behavioural **baseline** — the reference for what the CLI must still do, not a frozen
contract.

## Verified groundwork

Everything below was spiked against the real packages before planning (`/tmp/effect-v4`), not
assumed:

- **Effect v4 rc ships the CLI module.** `effect@4.0.0-rc.112` contains `effect/unstable/cli`
  (`Command`, `Flag`, `Argument`, `Param`, `CliError`, `CliOutput`, `HelpDoc`) — the module the
  effect.solutions article describes. Per your instruction: it exists, so v4 it is.
- `Flag.withMetavar("NAME")` renders `--map NAME` in generated help.
- `Param.variadic(Flag.string("artifact"))` gives repeated `--artifact a --artifact b`.
  `Flag.variadic` does **not** exist; `Param.variadic` is public and typed for both param kinds.
- `Command.withSharedFlags` **must be applied before `withSubcommands`** for leaf handlers to read
  the value via `yield* parentCommand`. Applied after, the service lookup fails at runtime.
- Shared flags compose across levels and are accepted before *or* after the subcommand name:
  `wayful --project P map --map M create work` and `wayful map create work --map M` both parse.
- `Flag.withFallbackConfig(Config.string("WAYFUL_MAP"))` reads the environment variable
  declaratively, with the explicit flag correctly taking precedence. (Note: `Config.string`,
  lowercase — `Config.String` does not exist.)
- `Command.run(cli, { version, renderErrors: false })` + `Effect.catchCause` gives full control of
  error rendering; typed `CliError` tags (`UnrecognizedOption`, `UnexpectedArgument`,
  `MissingArgument`, …) are reachable off `cause.reasons`.
- `FileSystem` / `Path` are top-level `effect` modules in v4, provided by `BunServices.layer`.
- `Context.Service` + `Layer.effect` + `Data.TaggedError` work under `bun test`.
- **TypeScript 7.0.2** (the repo's pinned version) typechecks Effect v4 rc cleanly.

## Dependencies

Added to `packages/cli/package.json`, pinned exactly — these are release candidates:

- `effect@4.0.0-rc.112`
- `@effect/platform-bun@4.0.0-rc.112`

Bun stays the runtime, package manager, and test runner. `Bun.YAML` / `Bun.TOML` stay — Effect has
no YAML/TOML codec — but they become confined to the filesystem backend.

## Layering

Replace `packages/cli/src` with three layers. The dependency arrow only points inward:
`cli → backend → domain`.

```
src/
  main.ts                  # shebang entrypoint; wires layers, maps failures → exit codes
  domain/                  # pure. no I/O, no services
    errors.ts              # WayfulError, MapMetadataError (Data.TaggedError)
    identifier.ts          # IDENT, identifier(), nonEmpty(), slots(), formatVersion()
    model.ts               # ProjectMetadata, MapMetadata, StepRecord, ArtifactRecord,
                           #   GoalRecord, TypeDefinition, Slot, MapSnapshot
    graph.ts               # dependenciesOK, attachmentOK, attachmentErrors, nextSteps, cycles
    validate.ts            # validateMap(snapshot, { includeProgress })
    status.ts              # mapStatus(snapshot)
  backend/
    Backend.ts             # WayfulBackend service definition (the seam)
    filesystem/
      layer.ts             # FileSystemBackend
      paths.ts             # .wayful layout
      documents.ts         # frontmatter, YAML/TOML, atomic temp-file + rename
      decode.ts            # raw document → domain record, with the diagnostic messages
  cli/
    flags.ts               # shared Flag/Argument definitions, metavars, env fallbacks
    context.ts             # resolveProject / resolveMap
    render.ts              # human + JSON renderers
    commands/{init,map,step,artifact,goal,type}.ts
    cli.ts                 # command tree assembly
```

Ported from the current code, minus the I/O: `validate` and `attachmentErrors`
(`model.ts:261-379`) → `domain/validate.ts`; `attachmentOK` / `dependenciesOK` (`model.ts:248-303`)
and the `reaches` cycle check (`commands/step.ts:135-143`) → `domain/graph.ts`; `slots` /
`identifier` / `nonEmpty` / `version` (`core.ts:14-97`) → `domain/identifier.ts`; `bodyLines` and the
`map show` / `map status` formatters (`commands/map.ts:69-136`) → `cli/render.ts`.

## The backend seam

```ts
class WayfulBackend extends Context.Service<WayfulBackend, {
  initProject(o: { directory: string; description: string }): Effect<void, WayfulError>
  openProject(hint: Option<string>): Effect<ProjectHandle, WayfulError>

  listTypes(p: ProjectHandle): Effect<readonly TypeDefinition[], WayfulError>
  getType(p: ProjectHandle, name: string): Effect<TypeDefinition, WayfulError>

  listMaps(p: ProjectHandle): Effect<readonly MapMetadata[], WayfulError>
  createMap(p: ProjectHandle, o: { name; start; goal; goalBody }): Effect<void, WayfulError>
  openMap(p: ProjectHandle, name: string): Effect<MapHandle, WayfulError | MapMetadataError>
  setStepIdCounter(m: MapHandle, next: number): Effect<void, WayfulError>

  listSteps(m: MapHandle): Effect<readonly StepRecord[], WayfulError>
  createStep(m: MapHandle, step: StepRecord): Effect<void, WayfulError>
  saveStep(m: MapHandle, step: StepRecord): Effect<void, WayfulError>

  listArtifacts(m: MapHandle): Effect<readonly ArtifactRecord[], WayfulError>
  createArtifact(m: MapHandle, artifact: ArtifactRecord): Effect<void, WayfulError>

  listGoals(m: MapHandle): Effect<readonly GoalRecord[], WayfulError>
  createGoal(m: MapHandle, goal: GoalRecord): Effect<void, WayfulError>
  saveGoal(m: MapHandle, goal: GoalRecord): Effect<void, WayfulError>
}>()("wayful/Backend") {}
```

Three decisions make this a real seam rather than a renamed `model.ts`:

- **Records carry no paths.** Identity is `id` / `name`; the filesystem backend recomputes
  `<id>-<name>.md` itself. An HTTP backend would use the same records unchanged.
- **`create*` is distinct from `save*`.** "Creation commands fail when their target already exists"
  becomes a backend precondition returning `AlreadyExists`, replacing the caller-side `existsSync`
  checks scattered through `commands/*.ts` — which are also a TOCTOU race.
- **Cross-cutting checks live above the backend.** The `allowed_step_types`-references-a-known-type
  check currently sits inside `mapContext` (`model.ts:76-78`). It needs both map metadata and the
  type list, so it moves to `cli/context.ts`'s `resolveMap`, raising `MapMetadataError` so
  `map validate` still reports it as an invalid map rather than an operational failure.

Everything filesystem-specific stays inside `backend/filesystem/`: upward `.wayful/project.toml`
discovery, `<id>-<name>.md` naming, the `.yaml`/`.yml` collision rule, frontmatter parsing, and
atomic temp-file + rename writes.

**Not using `Schema` for record decoding.** The CLI's product value is its diagnostics
(`SPEC.md:150`), and the current hand-written validators produce precise messages like
`required_inputs contains an invalid slot` and `step 'x' fulfills inputs slot 'source' more than
once`. I have not verified that Schema's issue formatting reaches that quality without heavy
annotation, so I am keeping the ported validators rather than proposing an untested rewrite. Domain
records stay plain TypeScript types. Revisit later if it proves worth it.

## Behaviour: what stays, what changes

### Stays (the parts worth keeping)

- Exit codes `0` success / `1` invalid map from `map validate` / `2` usage, operational, config
  error. This is a real scripting contract (`SPEC.md:116`) and cheap to preserve.
- `wayful: <message>` on stderr for domain errors, with no stack trace.
- Every persisted file format: TOML metadata, Markdown + YAML frontmatter, block-style YAML,
  atomic writes, format versioning.
- All domain rules and their diagnostic wording.

### Changes (Effect defaults and capabilities that are better)

1. **Help is Effect-generated** — `DESCRIPTION` / `USAGE` / `ARGUMENTS` / `FLAGS` / `GLOBAL FLAGS`
   replaces the hand-written `Required options:` / `Required arguments:` blocks, and is derived from
   the command definitions rather than maintained in parallel. `withMetavar` keeps `--map NAME`,
   `--goal-body TEXT`, `--required-outputs JSON` readable.
2. **`--map` becomes a group-level shared flag**, so `wayful map --map plan show` and
   `wayful step --map plan create work --type task …` work alongside the current trailing form. New
   capability; the hand-rolled parser could not do this.
3. **`WAYFUL_PROJECT` / `WAYFUL_MAP` become declarative** via
   `Flag.withFallbackConfig(Config.string(…))` instead of hand-read `process.env` lookups, with flag
   precedence handled by the framework.
4. **`--json` failures emit `{"error": "<message>"}` on stdout** and exit non-zero, instead of the
   current mix where only `map validate` produces structured failure output. This is the one
   deliberate JSON change: it makes `--json` a total contract, which is what an automation consumer
   (`server.ts`) actually needs.
5. **Parse errors print command help to stdout** in addition to `wayful: …` on stderr. Effect renders
   help unconditionally; `server.ts` already tolerates non-JSON stdout.
6. Bare `wayful` / `wayful map` print Effect's help; `--version` alongside a subcommand prints the
   version instead of erroring.

Otherwise **JSON shapes are left alone.** They are reasonable, and churn is not free — each change
costs `packages/ui/server.ts`, `packages/ui/src/lib/wayful.ts`, and the UI tests. I would rather
spend that budget on the backend seam.

## TDD sequence

Following the SPEC's own red/green convention (`SPEC.md:133`), tests first at each step:

1. **Red baseline.** Port `test/wayful.test.ts` → `test/cli.test.ts`, updating only the assertions
   covering the deliberate changes above (the two help-header assertions, and adding `--json` error
   coverage). Run: everything red.
2. **Domain.** Write `test/domain.test.ts` against the pure rules — slot validation, attachment
   errors, cycle detection, `validateMap`, `nextSteps`, status counts — using in-memory snapshots.
   These assertions are currently only reachable through a subprocess. Then implement `domain/`.
3. **Backend.** Write `test/backend.test.ts` as a contract suite parameterised over a
   `Layer<WayfulBackend>`, run against `FileSystemBackend` in a temp directory: round-trips, body
   preservation, `.yml`/`.yaml` collision, filename/identity mismatch, `create*` refusing to
   overwrite, atomic write behaviour. Then implement `backend/`.
4. **CLI, in slices**, driving `cli.test.ts` green group by group: project/type → map → step →
   artifact/goal → validation/status.
5. Update `packages/ui/server.ts` for the `--json` error shape; keep the UI suite green.
6. `bun run check` (oxfmt + oxlint + tsc + all package tests).

## SPEC.md updates

`SPEC.md` lines 18, 86, and 138 assert a zero-dependency Bun CLI. Those get rewritten for the Effect
dependency, along with the help-format, shared-flag, and `--json` error decisions above, so the spec
continues to describe the thing that exists.

## Verification

```sh
nix develop --command bun install
nix develop --command bun run --filter './packages/cli' test   # ported suite + new unit suites
nix develop --command bun run check                            # lint + typecheck + all packages
```

Then an end-to-end pass in a scratch directory, covering the paths the viewer depends on:

```sh
cd "$(mktemp -d)"
W="bun <repo>/packages/cli/src/main.ts"
$W init --description "smoke"
$W map create --map plan --start here --goal done
$W step create work --map plan --type task --description "Do it"
$W artifact add proof --map plan --kind document --ref git:abc
$W step complete work --map plan --summary "done"
$W goal satisfy --map plan --goal initial-goal --artifact proof
$W map validate --map plan --json     # expect {"valid":true,"errors":[]}, exit 0
$W map status --map plan
$W map show --map plan --json | jq .  # shape unchanged
```

Plus the new-capability checks: `wayful --project DIR map --map plan show`,
`WAYFUL_MAP=plan wayful map show`, `wayful step create --help`, and a `--json` failure
(`wayful map show --map missing --json` → `{"error": …}`, exit 2).

Finally, run the viewer against a populated project (`bun run --filter './packages/ui' dev`) to
confirm the overview, map, and step endpoints still render.
