# Wayful filesystem CLI specification

## Problem Statement

Wayful defines a flexible graph of work: projects contain maps, maps contain
interdependent steps, and steps consume and produce artifacts in service of
goals. The documented workflow currently has no executable system to create,
persist, inspect, validate, or evolve that graph.

People and agents need a local, scriptable CLI that manages Wayful state
without managing the substantive work within a step. It must be simple to run
in a Bun environment, safe for a repository working tree, readable and
editable as files, and suitable for both interactive terminal use and
automation.

## Solution

Build a Bun CLI in `packages/cli`, on top of Effect's CLI module
(`effect/unstable/cli`). It exposes a `wayful` executable, discovers
directory-scoped projects, and persists all data in a project's `.wayful`
folder. The implementation separates a pure domain layer (validation, graph
integrity, status — no I/O), a `WayfulBackend` service seam (the filesystem is
its first and only implementation), and a CLI layer built from Effect
`Command`/`Flag`/`Argument` definitions. The dependency arrow points inward:
`cli → backend → domain`.

The CLI implements the Wayful commands documented in `SKILL.md`, plus the
settled project-level type inspection commands and step inspection needed to
surface type instructions. It stores project and map metadata as TOML, steps
as Markdown documents with YAML frontmatter, type definitions as Markdown
documents with YAML frontmatter, artifacts as YAML records, and goals as
Markdown documents with YAML frontmatter. Generated YAML uses multiline block
style rather than compact flow-style mappings and non-empty sequences. The
files remain deliberately human-readable and manually editable.

`src/main.ts` is the entrypoint, declared as the package's `wayful` bin and
executable directly through its `#!/usr/bin/env bun` shebang. Bun's presence
and version are enforced by the package `engines` field and the repository's
Nix dev shell rather than by a hand-rolled shell preamble. It is a local tool,
not a package intended to be published.

## User Stories

1. As a project owner, I want to initialize Wayful state in a directory, so that I can manage maps alongside my existing work.
2. As a user working in a nested directory, I want the CLI to discover the enclosing Wayful project, so that I do not have to return to the project root.
3. As an automation author, I want to select a project explicitly with `--project`, so that scripts are independent of their working directory.
4. As an automation author, I want `WAYFUL_PROJECT` to provide project context, so that a sequence of commands stays concise.
5. As a map owner, I want to create a map with a name, starting point, and initial goal, so that the destination and current situation are explicit.
6. As a map owner, I want map metadata persisted separately from its steps, so that the map is inspectable and manually maintainable.
7. As a user, I want to select a map explicitly with `--map` or `WAYFUL_MAP`, so that map-scoped commands are unambiguous.
8. As an automation author, I want explicit `--project` and `--map` values to override environment context, so that a one-off command can safely change scope.
9. As a user, I want map context to be required when it cannot be resolved, so that commands never modify an unintended map.
10. As a map owner, I want to create a typed step with a concise result description, so that the map represents useful work without prescribing its execution.
11. As a user, I want every created step to receive a monotonically increasing integer ID, so that steps can be addressed concisely and reliably.
12. As a user, I want to address a step by either its stable name or its integer ID, so that both human and script workflows are convenient.
13. As a map owner, I want to update a pending step's description, so that the map can adapt as I learn more.
14. As a map owner, I want to express a dependency between two steps, so that ordering and prerequisites are visible in the graph.
15. As a map owner, I want invalid self-dependencies, duplicate dependencies, and cycles to be rejected, so that the step graph remains meaningful.
16. As a map owner, I want to cancel obsolete pending or blocked steps with a reason, so that the map records changed understanding rather than hiding it.
17. As a worker, I want to block and unblock a step with an explanatory reason, so that impediments are visible without changing the graph.
18. As a worker, I want to complete a step with a summary only after its promised outputs are recorded, so that completion has traceable evidence.
19. As a user, I want to register artifacts using opaque references such as paths, URLs, commits, or pull requests, so that Wayful does not impose storage technology constraints.
20. As a worker, I want to attach artifacts as a step's inputs and outputs, so that a step's prerequisites and produced evidence are explicit.
21. As a type author, I want named artifact slots with kinds and optional descriptions, so that a category of work can declare its minimum input/output contract.
22. As a worker, I want to bind an artifact explicitly to a required input or output slot, so that contract satisfaction never depends on ambiguous inference.
23. As a worker, I want to attach supplementary artifacts outside required slots, so that useful context can be recorded without changing a type contract.
24. As a map owner, I want `map next` to list pending steps whose dependency and required-input prerequisites are met, so that I can choose an actionable next step.
25. As a map owner, I want to add multiple named goals, so that a map can represent more than one required destination.
26. As a map owner, I want to satisfy a goal with artifact evidence, so that map completion can be verified.
27. As a map owner, I want to validate a map without modifying it, so that I can determine whether its graph, evidence, goals, and blockers support completion.
28. As a user, I want a concise status view, so that I can understand progress, blockers, goals, and actionable work quickly.
29. As an automation author, I want deterministic JSON output for read commands, so that tooling need not parse presentation-oriented terminal text.
30. As a user, I want project-level type definitions stored one per readable file, so that I can inspect and manually edit reusable work contracts.
31. As a user, I want `type list` and `type show` commands, so that manually maintained type definitions are discoverable without a separate editor.
32. As a type author, I want optional Markdown instructions on a type, so that workers and agents can see current guidance when inspecting a step.
33. As a map owner, I want a map to optionally restrict which project types it permits, so that a focused map cannot accumulate inappropriate work categories.
34. As a worker, I want a step to snapshot type-required slots when created, so that later type-contract edits do not retroactively change its promised artifacts.
35. As a worker, I want step inspection to resolve live type instructions, so that instructions can improve without editing every existing step.
36. As a user, I want readable errors and stable exit statuses, so that I can correct problems and write robust shell automation.
37. As a project owner, I want commands to avoid overwriting existing Wayful records implicitly, so that the CLI is safe in a version-controlled workspace.
38. As a project owner, I want persisted documents to have a format version, so that future CLI versions can identify incompatible data safely.
39. As a user without Bun, I want the entrypoint to explain that Bun is required, so that a failed invocation has an actionable remedy.
40. As a user with an unsupported Bun version, I want the entrypoint to report the required version, so that runtime failures are prevented early.
41. As a map owner, I want goals and steps to carry an optional Markdown body, so that detailed context can live beside their concise structured metadata.
42. As a user, I want goal and step bodies included in inspection output, so that I do not need to open their files separately.
43. As a user editing generated state, I want YAML mappings and non-empty sequences written in multiline block style, so that records remain easy to review and maintain.
44. As a project owner, I want to list every map without choosing one first, so that I can discover the available work maps.

## Implementation Decisions

- The implementation is a local Bun CLI built on `effect` and `@effect/platform-bun`, pinned to exact release-candidate versions (`4.0.0-rc.112` at the time of writing) since v4's CLI module is still pre-release. It uses Bun's native YAML and TOML parse/stringify facilities — confined to `backend/filesystem/`, since Effect has no YAML/TOML codec of its own — and Bun's test runner; the repository's shared lint, format, and typecheck tooling remains the only additional development dependency.
- Help output is generated by Effect's CLI module from the command definitions themselves (`DESCRIPTION`, `USAGE`, `ARGUMENTS`, `FLAGS`, `GLOBAL FLAGS` sections), rather than maintained by hand in parallel with a parser.
- `--map` is a shared flag declared once per command group (`step`, `artifact`, `goal`) and accepted both before and after the subcommand name — `wayful step --map plan create work` and `wayful step create work --map plan` both parse. `--project` is a shared flag on the root command for the same reason. `map create`'s own `--map NAME` names the map being created and is unrelated to this context-selection flag.
- Every `--json` invocation is a total contract: a failure emits `{"error": "<message>"}` on stdout (in addition to `wayful: <message>` on stderr) and exits non-zero, not just `map validate`. `map validate`'s own `{valid, errors}` shape is unchanged and is not itself an error response even when `valid` is `false` and the exit code is 1.
- The CLI is not packaged or published. `src/main.ts` carries a `#!/usr/bin/env bun` shebang and is declared as the package's `wayful` bin, so a workspace install links it as `node_modules/.bin/wayful`.
- The supported Bun version is declared once in the package `engines` field as `>=1.4.1`, the first verified project baseline that provides both `Bun.YAML.stringify` and `Bun.TOML.stringify`. Documentation uses that declaration rather than duplicating an unrelated version constant.
- Project discovery walks upward from the supplied `--project` directory, `WAYFUL_PROJECT` directory, or current working directory, stopping at the first directory containing `.wayful/project.toml`. An absent project produces an `init`-oriented error.
- Context precedence is explicit flag, then environment variable, then project discovery. No map is inferred merely because a project contains one map.
- `map list` is project-scoped and does not require map context. It returns every valid map in ascending name order, showing `name: start` in human output and map metadata objects in JSON output.
- Project state is rooted at `.wayful`. `project.toml` stores `format_version`, project description, and other project-level metadata. Maps are folders under `.wayful/maps/<map-name>`, each with `map.toml`.
- `project.toml` and `map.toml` use `format_version = 1`. Readers treat omitted format versions as version 1 for this initial format, reject newer unsupported versions, and reject malformed metadata.
- A map's `map.toml` stores its name, start, next integer step ID, and optional `allowed_step_types`. Absent `allowed_step_types` permits every valid project type. A present list is an ongoing restriction: an existing step with an excluded type makes validation fail.
- Safe identifiers for maps, steps, artifacts, goals, type names, and slot names use lowercase kebab case: `[a-z0-9]+(?:-[a-z0-9]+)*`. Purely numeric step names are rejected, reserving numeric references for IDs. Unsafe paths, separators, traversal, whitespace, dots, and reserved/empty values are rejected.
- Steps reside in a map's `steps` directory as Markdown files named `<id>-<step-name>.md`. YAML frontmatter is authoritative structured state. The Markdown content after the frontmatter is the optional `body` field and must be preserved across frontmatter updates.
- Step frontmatter contains: ID, name, type, description, status, dependencies, input attachments, output attachments, resolved required input slots, resolved required output slots, completion summary, cancellation reason, and block reason. It deliberately contains no created, updated, completed, or cancelled timestamp metadata.
- Step statuses are `pending`, `blocked`, `complete`, and `cancelled`. Valid transitions are pending to blocked, blocked to pending, pending/blocked to complete, and pending/blocked to cancelled. Completed and cancelled steps are terminal in v1.
- Completion requires a non-empty summary and every resolved required output slot to be fulfilled by an existing matching artifact. It does not require an output if no output slots were declared. Cancellation and blocking each require non-empty reasons.
- `step depends` rejects self references, duplicates, cycles, cancelled prerequisites, and attempts to change completed steps. A cancelled prerequisite leaves dependents non-actionable and is reported by validation rather than forcing cascading graph changes.
- Artifacts are map-local YAML metadata records in an `artifacts` directory. Each has a unique name, non-empty kind, and opaque non-empty reference. Artifact references are never dereferenced or externally validated.
- Goals are map-local Markdown documents with YAML frontmatter in a `goals` directory. Their Markdown content after the frontmatter is the optional `body` field and must be preserved across frontmatter updates. `goal add` requires both `--name` and `--description`. A goal is satisfied by one or more references to existing map-local artifacts.
- `goal list` reports all goals; `goal satisfy` requires `--goal` and at least one evidence artifact reference. Re-satisfying a satisfied goal is rejected unless a future explicit evidence-amendment operation is designed.
- Type definitions are project-level Markdown files at `.wayful/types/<type-name>.md`. The filename stem and YAML `name` are both required and must match. Their frontmatter holds `format_version`, `name`, required non-empty `description`, `required_inputs`, and `required_outputs`; their Markdown body is the `instructions` field (which may be empty).
- Required input/output slots are arrays of objects. Each object has unique `name`, required `kind`, and optional non-empty `description`. Each list must not repeat a slot name. A slot name may exist once in inputs and once in outputs. The initialized generic `task` type has empty input/output slot lists and may have an empty instructions body.
- Type definitions are maintained through manual filesystem editing. The CLI exposes only project-scoped `type list` and `type show <name>` read commands; it does not create, update, or delete types.
- `init` creates the single generic `task` type. `step create` requires a valid project type permitted by the selected map.
- `step create --body <text>` and `goal add --body <text>` initialize their optional Markdown bodies. `step update --body <text>` replaces a pending step's body and may be used with or without `--description`. `map create --goal-body <text>` initializes the first goal's body. An omitted body is represented as an empty string when read.
- On step creation, type-required input/output slot arrays are snapshotted into the step. `--required-inputs '<json-array>'` and `--required-outputs '<json-array>'` replace their respective inherited arrays when supplied. JSON uses the same slot-object shape as the type frontmatter. An explicitly empty array removes requirements for that direction.
- A type's Markdown instructions are not copied into steps. Step inspection resolves and displays current instructions from the referenced type. If the type is missing or malformed, inspection still exposes persisted step state and states that instructions are unavailable; map validation fails.
- `step input` and `step output` attach an existing artifact. `--slot <slot-name>` explicitly fulfills a required slot, verifies direction, verifies artifact kind, and rejects a slot already fulfilled. One artifact can be attached to multiple slots only via explicit attachment calls. Calls without `--slot` are supplementary attachments and do not fulfill a requirement.
- `map next` returns pending steps sorted by integer ID for which every dependency is complete and every resolved required input slot has an existing correctly typed artifact attachment. Blocked, complete, and cancelled steps are excluded.
- `map list` presents the project's maps. `map show` presents map metadata, goals, artifacts, and steps, including goal and step bodies. `map status` presents a concise deterministic health/progress summary including goal progress, step counts, blockers, and actionable steps. `step show` presents individual step state, its body, resolved required slots, attachments, and current type instructions. `goal list` includes goal bodies.
- Read-oriented commands support `--json` for stable structured output. Goal and step objects in inspection JSON include `body`. Human output from `map show`, `step show`, and `goal list` prints the body, using `(empty)` when no body exists. Human output is deterministic and suitable for terminal reading; JSON is the scripting contract. `--json` is a total contract: any command's failure emits `{"error": "<message>"}` on stdout and exits non-zero, so a `--json` caller never has to fall back to parsing stderr.
- `map validate` is read-only. It checks parseability, format support, identifier validity, duplicate identities, type-file name mismatches, unknown/missing/invalid types, map type restrictions, graph references and cycles, slot/attachment integrity, completed output requirements, goal evidence, unresolved goals, blockers, and active unfinished steps. A valid map has no integrity failures, all goals satisfied with valid evidence, no blocked steps, and no pending steps. Cancelled steps are permitted unless they invalidate a dependency relationship.
- Expected command errors are concise stderr messages prefixed `wayful:` with no stack trace. `--help` is available at the root and command-group levels, and `--version` is available at the root. Exit code 0 means success/valid map, 1 means an invalid map from `map validate`, and 2 means usage, operational, persistence, or configuration error.
- Creation commands fail when their target already exists. There is no `--force` in v1. Persistence uses Bun's official `YAML.stringify` and `TOML.stringify` APIs. YAML is rendered with indentation so mappings and non-empty sequences use multiline block style; empty collections may use `[]` or `{}`. Writes validate all relevant state before mutation and use sibling temporary-file writes followed by rename for atomic single-file replacement. The first release documents a single-writer expectation and does not implement multi-process locks or transactions.
- The CLI is organized around three layers rather than one executable seam: `domain/` is pure (no I/O, no services) and holds validation, graph integrity, and status computation over plain records; `backend/` defines the `WayfulBackend` service — `initProject`, `openProject`, `listTypes`/`getType`, `listMaps`/`createMap`/`openMap`/`setStepIdCounter`, and `list*`/`create*`/`save*` for steps, artifacts, and goals — with `backend/filesystem/` as its only implementation today; `cli/` resolves context, calls the backend, and renders output. Records carry no paths — the filesystem backend recomputes `<id>-<name>.md` itself — so another backend could implement the same interface unchanged. `create*` operations are distinct from `save*` operations: creation fails when the target already exists, replacing scattered existence checks (and the TOCTOU race they implied) with a single backend precondition.

## Testing Decisions

- There are three test seams, one per layer. `domain/` rules (slot validation, attachment errors, cycle detection, `validateMap`, `nextSteps`, status counts) are tested directly against in-memory snapshots — no process, no filesystem. `backend/filesystem/` is tested as a contract suite against a real temporary directory, parameterized over the `WayfulBackend` service: round-trips, body preservation, the `.yml`/`.yaml` collision rule, filename/identity mismatches, `create*` refusing to overwrite, and atomic write behavior. The full CLI is still tested end-to-end: invoking `src/main.ts` in a child Bun process against fresh temporary filesystem projects, asserting process exit status, stdout/stderr, and persisted file contents.
- Tests must not assert private function calls, module layout, or incidental serialization ordering beyond the documented persistence contracts. They should assert user-visible command behavior, valid readable documents, and domain outcomes.
- The test suite uses `bun:test`, Bun/standard process and filesystem APIs, and Effect's own runtime (`Effect.runPromise`, `Layer.provide`) for the domain and backend suites; no other external test helpers or fixture dependencies are introduced.
- Bun discovery and version gating are no longer the CLI's responsibility, so no test covers them; the tests exercise command behavior only.
- Project tests cover initialization, upward discovery, `--project` and `WAYFUL_PROJECT` precedence, existing-project refusal, malformed and unsupported project metadata, and safe identifier rejection.
- Map tests cover creation, project-scoped map listing, explicit/environment map selection and precedence, existing-map refusal, map display/status, optional manual type restrictions, and map metadata validation.
- Step tests cover creation, monotonic IDs, lookup by name and ID, description and body updates, body inspection, all allowed/forbidden state transitions, completion/cancellation/block reasons, body preservation, dependency integrity/cycle detection, and immutable terminal steps.
- Artifact and attachment tests cover registration, duplicate rejection, opaque references, required slot attachment, artifact-kind mismatches, duplicate slot fulfillment, supplementary attachment, input readiness, and output completion requirements.
- Goal tests cover required explicit names, optional bodies, add/list/satisfy flows, body preservation and inspection, evidence existence, duplicate/re-satisfaction behavior, and validation of unsatisfied or unevidenced goals.
- Type tests cover initialized `task`, manual type discovery, list/show, YAML/frontmatter parsing, filename/name mismatch, optional instruction bodies, slot-schema validation, step slot snapshots, JSON replacement overrides, map restrictions, missing types, and live instruction resolution.
- Multiline block-style YAML generation, `map next`, status, show, JSON rendering, validation diagnostics, exit statuses, malformed YAML/TOML/Markdown frontmatter, and no-implicit-overwrite behavior receive integration coverage.
- Red phase work creates the executable scaffold and these tests without implementing domain behavior beyond what is necessary to execute and observe intentionally failing assertions. Green phase work makes the suite pass without weakening its specification assertions.

## Out of Scope

- Publishing the CLI as an npm package, a global installer, or a Bun package release.
- Dependencies beyond `effect` and `@effect/platform-bun`; persistence stays on Bun's built-in YAML/TOML facilities rather than a third-party codec.
- Interactive prompts, a TUI, or automatic workflow execution inside steps.
- Type creation/editing/deletion commands; type and map restriction editing beyond documented manual file edits.
- Arbitrary per-type schemas, custom lifecycle state machines, or a general validation-language engine.
- Dependency removal, step renaming, step type changes, reopening terminal steps, or goal evidence amendment commands.
- Filesystem, URL, Git, PR, or permission validation of opaque artifact references.
- Multi-process write locks, crash-safe multi-file transactions, remote persistence, synchronization, or migration tooling beyond explicit format-version detection.
- Automatic map selection when only one map exists.

## Further Notes

- The CLI manages Wayful map state, not the work inside a step. Users and agents do substantive research, design, implementation, or review elsewhere, then record artifacts and transitions here.
- Manual persistence editing is an intentional part of the design. Strict validation and readable diagnostics are therefore essential rather than optional defensive behavior.
- The zero-dependency hand-rolled parser and single-file model were the project's initial CLI code; the Effect rebuild replaced both while keeping the process-level CLI suite as one of its test seams, alongside new unit and contract suites for the domain and backend layers.
- The executable's declared Bun minimum is isolated in local metadata so it can be adjusted if native Bun YAML/TOML API compatibility requires a later baseline.
