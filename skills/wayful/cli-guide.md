Initialize a project and create a map with a clear starting point and destination:

```sh
cd website-redesign
wayful init --description "Refresh the marketing site"
wayful map create --map redesign \
  --start "Current production site" \
  --goal "Accessible, approved redesign is released" \
  --goal-body "Release criteria and stakeholder context."
```

For example, from a different working directory, address that project explicitly:

```sh
wayful --project ../website-redesign map status --map redesign
```

All map-scoped commands require `--map <map-name>` when a map has not been supplied through the environment. Use `show` to inspect an individual primitive and `status` to understand the map as a whole:

```sh
wayful map list
wayful map show --map redesign
wayful map status --map redesign
wayful map next --map redesign
```

`wayful map list` is project-scoped: it does not need `--map` and shows every
available map with its starting point.

For less verbose batch changes, set the project and map context with `WAYFUL_PROJECT` and `WAYFUL_MAP`. `WAYFUL_PROJECT` holds a path to the project and `WAYFUL_MAP` holds a map name. They provide the same context as `--project` and `--map`, so commands can omit those flags:

```sh
export WAYFUL_PROJECT=/path/to/website-redesign
export WAYFUL_MAP=redesign
wayful step update 2 --description "Produce an approved responsive proposal"
wayful step complete 2 --summary "Proposal approved"
```

An explicit `--project` or `--map` takes precedence over its corresponding environment variable. `wayful map next` returns steps that are currently actionable: their dependencies are satisfied and their required input artifacts are available. Treat this as guidance rather than a mandate. If the map is incomplete, add or revise steps before proceeding.

## Orient with context

`context` answers "what's here, and what's next" at any scope, without a second command. Bare `context` is project scope; a bare map name drills into that map; a step reference or an artifact ref drills further still — into what that one primitive connects to:

```sh
wayful context
wayful context redesign
wayful context 'redesign/#3'
```

With `--map`/`WAYFUL_MAP` already set, the map-qualified prefix can be dropped (`context` reads that context but has no `--map` flag of its own). An artifact ref addresses artifact scope directly — a bare, scheme-prefixed string like `file:docs/research/interviews.md`, never map-qualified, since it names the artifact itself rather than a registered entry:

```sh
export WAYFUL_MAP=redesign
wayful context '#3'
wayful context 'file:docs/research/interviews.md'
```

Step scope shows the step's type, status, and description; its upstream dependencies with their current status; the downstream steps waiting on it (no other command answers this); its input artifacts with presence; and its recorded outputs alongside any required output slots still unfilled. It deliberately omits the step body and the full type instructions — that's what `step show` and `type show` are for; `context` shows how a thing connects, `show` shows what it says.

Artifact scope shows the artifact's kind and ref plus a reverse index: which steps produced it, which steps consume it as input, and which goals attach it as an output — the answer to "where did this come from and what relies on it?" without reading every step by hand. There is no separate artifact registry (ADR-0004): an artifact is just a ref that shows up in one or more attachments, and `artifact list`/`artifact show` (and this `context` scope) derive it from those attachments on demand.

Add `--json` to any `context` call for the same information as stable output for scripting. Add `--since 7d` (a duration) or `--since 2026-08-01` (an absolute date) to trim recent activity and the completed-steps tail at project and map scope, without ever hiding actionable or blocked work.

## Define steps and their relationships

### Inspect step types

Step types are manually maintained Markdown files in `.wayful/types`. Their
frontmatter provides a type's `name` and concise `description`; the Markdown
body provides its instructions. List available types with their descriptions,
or inspect one type together with its instructions:

```sh
wayful type list
wayful type show research
```

Add steps using a type supported by the project's or map's configuration. Give each step a concise description of the result it should achieve, rather than a rigid implementation plan. Every step also receives an automatically generated integer ID, starting at `1` and increasing for each new step.

Once a step exists, address it with a reference: a bare integer id (`1`), or `#` followed by its id or name (`#1`, `#research-users`). The bare-integer form only ever means a step id — reserve the `#` sigil for by-name addressing, since a bare name would otherwise be ambiguous with a map name. A step reference can be map-qualified with a `map/` prefix (e.g. `redesign/#1`) to address a step outside the current `--map`/`WAYFUL_MAP` context. Artifacts are addressed differently: by their ref directly (e.g. `file:docs/research/interviews.md`), never map-qualified — see "Attach artifacts and record progress" below.

```sh
wayful step create research-users \
  --map redesign \
  --type research \
  --description "Identify the most important usability problems" \
  --body "Focus on the checkout and account-recovery journeys."

wayful step create design-proposal \
  --map redesign \
  --type design \
  --description "Produce a redesign proposal informed by research"

wayful step depends #design-proposal --map redesign --on #research-users
```

For example, if `research-users` has ID `1` and `design-proposal` has ID `2`, the dependency can also be expressed with bare ids:

```sh
wayful step depends 2 --map redesign --on 1
```

Use dependencies to express ordering or prerequisites, not to force the entire future path up front. As work reveals new needs, create a new step, change a dependency, or retire a step that is no longer useful:

```sh
wayful step create accessibility-review --map redesign --type review
wayful step depends #accessibility-review --map redesign --on #design-proposal
wayful step update #design-proposal --map redesign --description "Produce an approved responsive proposal"
wayful step update #design-proposal --map redesign --body "Use the approved mobile-first design direction."
wayful step cancel #obsolete-wireframes --map redesign --reason "Superseded by the design proposal"
```

A dependency (`--on`) may itself be map-qualified, but only to the map already being addressed — cross-map dependencies are rejected explicitly rather than silently allowed.

## Attach artifacts and record progress

An artifact is not registered anywhere; it is just a ref — a file path, URL, commit, pull request, document, or other meaningful identifier, written with an explicit scheme (`file:docs/research/interviews.md`, `https://github.com/org/repo/pull/1`) — attached directly as a step's input or output. `wayful artifact list`/`wayful artifact show <ref>` are derived reads over whatever refs are currently attached somewhere in the map; there is nothing to add or remove independently of the steps and goals that reference them.

A step declares its required input/output slots at `step create` (via `--required-inputs`/`--required-outputs`, inherited from its type unless overridden), each a `{"name": ..., "kind": ...}` pair. `step input`/`step output` attach a ref to fulfill one of those slots (`--slot NAME`) or as a supplementary attachment carrying its own kind (`--kind KIND`) when no slot fits:

```sh
wayful step input #research-users --map redesign "file:docs/research/interviews.md" --slot source-material

# Perform the research outside the CLI, then record its result.
wayful step output #research-users --map redesign "file:docs/research/summary.md" --slot summary
wayful step complete #research-users --map redesign --summary "Findings documented in research-summary"
```

The same ref attached under two different slots — even in different steps — is one artifact, not two; identity is the normalized ref alone.

Mark a step `blocked` when it cannot proceed and include the reason. Mark it complete only after its promised outputs have been recorded. If a completed step changes the understanding of the map, update the map before selecting the next step.

```sh
wayful step block #design-proposal --map redesign --reason "Awaiting brand direction"
wayful step unblock #design-proposal --map redesign
wayful map next --map redesign
```

## Work with goals

Maps may have more than one goal. A goal declares its required output slots at `goal add`, the same shape a step declares — at least one is mandatory, since a goal with none would be satisfied the moment it was created. Attach refs to fulfill those slots with `goal output`, then satisfy the goal once every slot is filled:

```sh
wayful goal add --map redesign --name accessible --description "Design is accessible" \
  --body "Meet the documented WCAG acceptance criteria." \
  --required-outputs '[{"name": "audit-report", "kind": "document"}]'
wayful goal list --map redesign
wayful goal output --map redesign --goal accessible "file:docs/accessibility-report.md" --slot audit-report
wayful goal satisfy --map redesign --goal accessible
```

`goal satisfy` fails with an error if any required output slot is still unfilled; it takes no evidence of its own.

Before considering a map complete, run `wayful map validate --map redesign` and confirm that every goal is satisfied, required steps are complete, and no unresolved blockers remain.
