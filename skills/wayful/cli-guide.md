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

Add steps using a type supported by the project's or map's configuration. Give each step a concise description of the result it should achieve, rather than a rigid implementation plan. Every step also receives an automatically generated integer ID, starting at `1` and increasing for each new step. Commands accept either the step's name or its ID.

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

wayful step depends design-proposal --map redesign --on research-users
```

For example, if `research-users` has ID `1` and `design-proposal` has ID `2`, the dependency can also be expressed as:

```sh
wayful step depends 2 --map redesign --on 1
```

Use dependencies to express ordering or prerequisites, not to force the entire future path up front. As work reveals new needs, create a new step, change a dependency, or retire a step that is no longer useful:

```sh
wayful step create accessibility-review --map redesign --type review
wayful step depends accessibility-review --map redesign --on design-proposal
wayful step update design-proposal --map redesign --description "Produce an approved responsive proposal"
wayful step update design-proposal --map redesign --body "Use the approved mobile-first design direction."
wayful step cancel obsolete-wireframes --map redesign --reason "Superseded by the design proposal"
```

## Record artifacts and progress

Register artifacts wherever they live. An artifact reference may be a file path, URL, commit, pull request, document, or another meaningful identifier. Attach existing artifacts as step inputs and record new artifacts as outputs.

```sh
wayful artifact add user-interviews \
  --map redesign \
  --kind document \
  --ref "docs/research/interviews.md"
wayful step input research-users --map redesign --artifact user-interviews

# Perform the research outside the CLI, then record its result.
wayful artifact add research-summary \
  --map redesign \
  --kind document \
  --ref "docs/research/summary.md"
wayful step output research-users --map redesign --artifact research-summary
wayful step complete research-users --map redesign --summary "Findings documented in research-summary"
```

Mark a step `blocked` when it cannot proceed and include the reason. Mark it complete only after its promised outputs have been recorded. If a completed step changes the understanding of the map, update the map before selecting the next step.

```sh
wayful step block design-proposal --map redesign --reason "Awaiting brand direction"
wayful step unblock design-proposal --map redesign
wayful map next --map redesign
```

## Work with goals

Maps may have more than one goal. Add, inspect, and mark goals as satisfied as evidence becomes available:

```sh
wayful goal add --map redesign --name accessible --description "Design is accessible" \
  --body "Meet the documented WCAG acceptance criteria."
wayful goal list --map redesign
wayful goal satisfy --map redesign --goal accessible --evidence accessibility-report
```

Before considering a map complete, run `wayful map validate --map redesign` and confirm that every goal has supporting evidence, required steps are complete, and no unresolved blockers remain.
