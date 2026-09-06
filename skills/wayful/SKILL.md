---
name: wayful
description: Defines wayful work and how to work in a wayful manner. Use when "wayful" is mentioned by the user or the task
---

"Wayful" is a system or methodology for planning, orchestrating and completing (agentic) work. It can be used for any kind of work where you need to reach a goal or destination but the concrete path is still unclear or should not be fixed/set in stone.
Wayful is best used if you want a fundamentally flexible process but still need or want some structure and rules, especially regarding the handoff between steps.

# Glossary and Primitives

- **Wayful work**: Work that uses or follows the wayful system. Organizing work on **maps** with one or more **goals**, structuring it with interdependent **steps** that produce **artifacts**.
- **Project**: The biggest unit for structuring work. A project can have multiple maps.
- **Map**: A map is the core container primitive for wayful work. A map has a starting point and one or more **goals**. We are trying to find a path from the starting point to the goal(s) through a series of **steps**. The map is modeled as a graph structure where steps can depend on each other. The map is fundamentally **flexible**. This means the steps and final path do not need to be known ahead of time but they can evolve and change as the steps are completed. Wayful work is about exploring and charting the map as you go. However, certain parts of the map can be shaped by **rules**, e.g. to always include a certain step before or after another.
- **Step**: Steps are the fundamental primitive for representing work. Each step has a **type** as well as optional **input** and **output** artifacts. The **project** or **map config** defines which **step types** are available. The **step type** is a descriptive schema for a **step** (i.e. analog to class and instance). Steps can represent anything: research, planning, concrete tasks, validation, etc. They can have side effects, be pure, or anything inbetween. A step or the step type can define details about what work should be ccompleted and how. However, the step itself does not complete the work (its more like a GitHub issue not a workflow or script). The steps **inputs** and **output** can reference different **artifacts** to establish certain requirements (e.g. the "code review" step requires code and must return a verdict) and document produced artifacts.
- **Artifact**: Artifacts can be used to reference and document anything that is relevant to the work. Steps can "produce" artifacts or perform work based on existing artifacts. Similar to steps, the wayful system does not enforce any technical constraints. E.g. a "code artifact" could be a link to a PR, a refrence to a commit, or a path to a file.

# Using the wayful CLI

The CLI manages the map, not the work inside a step. Use it to capture the current state of work, discover what can happen next, and adapt the map as new information becomes available. Complete the substantive work with the appropriate tools, then record its result as artifacts and update the relevant step.

Note: the cli is not in path. Run it from its entrypoint in this repository: `packages/cli/src/main.ts` (or `node_modules/.bin/wayful` after `bun install`)

## Create and inspect work

Projects are scoped to directories. Initialize a project in its directory, then run `wayful` commands from that directory; the CLI discovers the current project by default. To operate on another project, pass its directory path with `--project`.

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
