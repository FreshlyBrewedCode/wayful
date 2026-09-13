---
name: wayful
description: Defines wayful work and how to work in a wayful manner. Use when "wayful" is mentioned by the user or the task
---

"Wayful" is a system or methodology for planning, orchestrating and completing (agentic) work. It can be used for any kind of work where you need to reach a goal or destination but the concrete path is still unclear or should not be fixed/set in stone.
Wayful is best used if you want a fundamentally flexible process but still need or want some structure and rules, especially regarding the handoff between steps.

# Glossary and Primitives

- **Wayful work**: Work that uses or follows the wayful system. Organizing work on **maps** with one or more **goals**, structuring it with interdependent **steps** that produce **artifacts**.
- **Project**: The biggest unit for structuring work, scoped to a directory. A project can have multiple maps, and it defines the **step types** they may use.
- **Map**: A map is the core container primitive for wayful work. A map has a starting point and one or more **goals**. We are trying to find a path from the starting point to the goal(s) through a series of **steps**. The map is modeled as a graph structure where steps can depend on each other. The map is fundamentally **flexible**. This means the steps and final path do not need to be known ahead of time but they can evolve and change as the steps are completed. Wayful work is about exploring and charting the map as you go. The one shape a map can fix in advance is which step types it allows.
- **Goal**: A destination on the map. A goal declares one or more **required output slots** and is **satisfied** once every one of them has an artifact attached — so a goal states what must exist for the work to be done, not merely that it should be. A map has at least one goal.
- **Step**: Steps are the fundamental primitive for representing work. Each step has a **type** as well as optional **input** and **output** artifacts. The **step type** is a descriptive schema for a **step** (i.e. analog to class and instance), and the project defines which types are available; a map may narrow that set but never extend it. Steps can represent anything: research, planning, concrete tasks, validation, etc. They can have side effects, be pure, or anything inbetween. A step or the step type can define details about what work should be completed and how. However, the step itself does not complete the work (its more like a GitHub issue not a workflow or script). The steps **inputs** and **outputs** can reference different **artifacts** to establish certain requirements (e.g. the "code review" step requires code and must return a verdict) and document produced artifacts.
- **Artifact**: Artifacts can be used to reference and document anything that is relevant to the work. Steps can "produce" artifacts or perform work based on existing artifacts. An artifact is just a **ref** — a scheme-prefixed string like `file:docs/research/summary.md` or `https://github.com/org/repo/pull/1` — attached directly to a step or goal. There is nothing to register or create separately: an artifact exists exactly as long as something references it, and the same ref attached in two places is one artifact, not two.
- **Slot**: A named, kinded requirement that a step or goal declares (`{"name": "summary", "kind": "document"}`). A step inherits its slots from its type unless they are overridden at creation. Attaching an artifact to a slot fulfills it; an artifact that fits no slot can still be attached as a **supplementary** attachment carrying its own kind.

## Step status

A step is `pending`, `blocked`, `complete`, or `cancelled`.

`blocked` is set deliberately, with a reason, when a step genuinely cannot proceed. A step that is simply waiting on unfinished dependencies or unfilled inputs is *not* blocked — it stays `pending` and is not yet **actionable**. `wayful map next` lists the actionable steps: pending, with every dependency complete and every required input filled.

# Using the wayful CLI

The CLI manages the map, not the work inside a step. Use it to capture the current state of work, discover what can happen next, and adapt the map as new information becomes available. Complete the substantive work with the appropriate tools, then record its result as artifacts and update the relevant step.

The CLI is the primary way to interact with wayful primitives.

## Quickstart

Use the `context` command to quickly gather context for a project, map, step, or artifact. Bare `context` starts at project scope; drill into a map, then a step, by passing a reference:
```sh
wayful context
wayful context redesign
wayful context 'redesign/#3'
```
An artifact is addressed by its ref rather than a reference, so it needs a map context rather than a map-qualified prefix. With `--map`/`WAYFUL_MAP` set, that context is already there:
```sh
export WAYFUL_MAP=redesign
wayful context '#3'
wayful context 'file:docs/research/interviews.md'
```
Quote or escape `#` references so the shell does not treat them as a comment.

## Create and inspect work

Projects are scoped to directories. Initialize a project in its directory, then run `wayful` commands from that directory; the CLI discovers the current project by default. To operate on another project, pass its directory path with `--project`.

## Guides

- `cli-guide.md` — the full command surface, with runnable examples.
- `github-guide.md` — running a project whose maps, steps, and goals live in GitHub Issues.
