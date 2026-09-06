# Wayful viewer specification

## Problem Statement

Wayful state is readable only through the CLI and the raw `.wayful` tree. Both
are adequate for an agent and poor for a human. `wayful map show` prints a
correct but unshaped wall of text; `map status`, `map next` and `map validate`
each hold one piece of the answer to "where is this work"; the dependency graph
that gives a map its shape exists only as `dependencies:` integers scattered
across step files.

The consequence is that the flexible, evolving graph Wayful exists to support is
the part hardest to see. A person picking up a map cannot quickly say what is
done, what is actionable, what is stuck and why, or which goals still lack
evidence — and so the map stops being consulted and starts going stale.

A read-only viewer closes that gap without adding a second source of truth.

## Solution

A local, read-only web viewer for a Wayful project. It serves a single page that
renders one map at a time as a dependency graph, a status board, or a list, with
a detail panel for the selected step.

It derives no domain state. Every status, count, readiness verdict and validity
finding comes from the CLI's existing `--json` output; the viewer's only
computation is visual layout. This is the load-bearing constraint: the viewer
must never be able to disagree with `wayful` about a map.

A working prototype exists at `skills/wayful/prototype/` and is the reference
artifact for this spec. Where a behaviour below is easier to read as code than
as prose, the prototype file is cited. The prototype is throwaway — it is
evidence of what the viewer should do, not the implementation to ship. See
`skills/wayful/prototype/README.md` for how to run it.

## User Stories

1. As a person new to a Wayful project, I want to open one URL and see every map with its progress, so that I can choose which one to look at without running commands.
2. As a map owner, I want a map's start and goals presented as the two ends of a journey, so that the destination is visible alongside the work.
3. As a map owner, I want to see which goals are satisfied and by which artifacts, so that I can judge whether the map is actually finishable.
4. As a worker, I want the dependency graph drawn left to right from start to goal, so that the shape of the path is apparent without reading step files.
5. As a worker, I want each step colour-coded by status, so that done, actionable, waiting, stuck and abandoned are distinguishable at a glance.
6. As a worker, I want steps that `map next` reports as actionable to be marked distinctly from other pending steps, so that I can see what I could start now.
7. As a worker, I want cancelled steps drawn in place rather than hidden, so that the map records changed understanding, and I want to hide them when they are noise.
8. As a worker, I want to select a step and read its description, body, and required input/output slots with their fulfilment state, so that I know what it promises and what it still owes.
9. As a worker, I want a selected step to show the current instructions resolved from its type, so that guidance improves without editing existing steps.
10. As a worker, I want to move between a step and its dependencies and dependents by clicking, so that I can trace why something is blocked.
11. As a map owner, I want blockers listed with their reasons, so that impediments are visible without hunting for them.
12. As a map owner, I want `map validate` findings shown as a readable list, so that I can see what stands between the map and completion.
13. As a worker, I want to pan and zoom the graph, so that a map larger than the screen stays usable.
14. As a worker, I want the graph to open at a zoom where labels are readable, and a separate control that frames the whole map, so that neither reading nor overview requires fighting the other.
15. As a worker, I want my pan and zoom preserved when I select a step or when the map reloads, so that the view does not jump while I am working.
16. As a worker on a phone, I want the whole viewer usable one-handed, so that I can check a map away from a desk.
17. As a worker, I want the map to reflect `.wayful` edits without a manual refresh, so that the viewer stays true while I or an agent work.
18. As a user, I want an empty map to say so plainly, so that "no steps yet" is distinguishable from "failed to load".
19. As a user, I want a malformed or unreadable map to report the CLI's own error, so that I diagnose it with the same message the CLI would give.
20. As a keyboard user, I want to reach every step and control without a pointer, so that the viewer is not mouse-only.
21. As a user, I want a light and a dark appearance that follows my system by default, so that the viewer is comfortable in either.
22. As an operator, I want to point the viewer at any project directory and choose its port and bind address, so that it can serve a repo other than the one it lives in.
23. As an operator, I want the viewer to be incapable of writing to `.wayful`, so that running it against a real project is risk-free.

## Implementation Decisions

- The viewer is a read-only client of the CLI. It invokes documented read commands with `--json` and forwards the result; it never opens `.wayful` for writing and issues no mutating command. Project metadata is the one direct read, because no command exposes `project.toml` (`skills/wayful/prototype/server.ts`).
- The CLI is the sole authority for domain state. Step status, step counts, goal satisfaction, actionability and validity are taken verbatim from `map show`, `map status`, `map next`, `map validate` and `step show`. The client computes only geometry. A number that is not in `--json` is not displayed.
- `ready` is a display status, not a domain status. It means a step whose `status` is `pending` and whose ID appears in `map next`. Wayful's four persisted statuses are unchanged.
- One map is in view at a time. A project-scoped request supplies the map list with a per-map status summary; a map-scoped request supplies that map's show/status/next/validate together, so a map switch is a single round trip.
- Step detail is fetched on selection rather than bundled with the map, because `step show` is the only command that resolves live type instructions.
- The graph assigns each step to a column by longest path over its dependencies, orders columns by step ID, and centres each column vertically. A start terminus sits left of the first column and a goal terminus right of the last (`skills/wayful/prototype/app.js`, `layer`).
- Steps with no dependencies are joined to the start terminus, and steps nothing depends on to the goal terminus, with a de-emphasised edge. Cancelled steps are drawn dimmed and struck through rather than removed, and are excluded from the goal-terminus edges.
- Dependency cycles are rejected by the CLI, but the layering guards against them anyway and degrades to depth 0 rather than recursing forever.
- The graph is a transform-based pan/zoom viewport filling the main column, not a scroll container. Drag pans, wheel and pinch zoom about the pointer, and explicit zoom-out / percentage / zoom-in / fit controls overlay one corner (`skills/wayful/prototype/app.js`, `attachViewport`).
- Zoom ranges from 0.15 to 2.5. The opening view is centred and fitted but floored at 0.55 so labels remain words; the explicit fit control has no floor and is honest about showing everything.
- The viewport transform is keyed to the map, the cancelled-steps setting and the canvas dimensions. A re-render with the same key preserves pan and zoom; a change of key returns to the opening view.
- A drag that moves more than a few pixels suppresses the click that ends it, so panning off a step never selects it. Panning is constrained so some of the map always remains on screen.
- Keyboard focus moving to an off-screen step pans it into view, because a transformed canvas cannot be scrolled into view by the browser.
- Three views share one selection and one map: a dependency graph, a board grouped by display status, and a table. The view switcher and the cancelled-steps toggle overlay the canvas rather than occupying a toolbar row.
- The layout has three regions: a map rail, the map itself, and a step detail panel. Below 1200px the detail panel becomes an overlay drawer; below 940px the rail becomes an overlay sheet; below 760px the start/goals journey stacks; below 720px the detail panel becomes a bottom sheet, the map header collapses behind a one-line summary, and the default view becomes the board, because a dependency graph is not readable at that width.
- With no step selected, the detail panel shows a map overview: step counts, actionable steps as links, and the `map validate` findings in full. Validate output is otherwise only a tooltip on the header verdict.
- Artifacts are shown by name and kind with their opaque reference available on inspection. The viewer never dereferences a reference, consistent with the CLI treating them as opaque.
- Change detection watches the project's `.wayful` directory and pushes an invalidation over Server-Sent Events; the client refetches and re-renders, preserving selection and viewport. Watching is best-effort — the viewer works without it.
- The server takes a project directory, port and bind address as arguments. It sets `WAYFUL_PROJECT` for the commands it spawns and clears `WAYFUL_MAP`, so an ambient shell value cannot select a map other than the one requested.
- `map validate` exits 1 for an invalid map. That is a finding to render, not a transport failure, and is distinguished from a command that produced no parseable JSON.
- Appearance follows `prefers-color-scheme` and is overridable, with the override persisted client-side. Status colours are defined per theme rather than shared, so contrast holds in both.

## Testing Decisions

- The primary seam is the HTTP surface plus the rendered DOM. Tests drive a real browser against a served fixture project and assert what a user can see, not internal module structure.
- Fixture projects are generated by the real CLI rather than hand-written, so the viewer is never tested against state the CLI could not produce. `skills/wayful/prototype/seed-demo.sh` is the working example.
- Fixtures must cover: a map exercising every status including cancelled and blocked; a map with steps but no satisfied goals; an empty map; and a malformed map.
- Contract tests assert that each endpoint's payload matches the corresponding CLI command's `--json` output for the same project, so drift in either is caught at the boundary.
- Rendering tests cover column assignment for chains, fan-out and fan-in, isolated steps, and cancelled steps; terminus edges; the `ready` derivation; and status classification for all four persisted statuses.
- Viewport tests cover opening zoom and its floor, fit, zoom about a pointer, pan constraints, drag-suppresses-click, transform preservation across a re-render, transform reset on map change, and focus-pans-into-view.
- Responsive tests assert the layout at each documented breakpoint, including the phone board default and the collapsed map header.
- Live-reload tests mutate the fixture through the CLI and assert the client updates while preserving selection and viewport.
- A read-only assertion is required: a test that exercises the full surface and then verifies the fixture's `.wayful` tree is byte-identical.
- Empty, malformed and missing-type cases assert the CLI's own message is surfaced rather than a generic failure.

## Out of Scope

- Editing anything. No step transitions, no artifact registration, no goal satisfaction, no map creation. The viewer is read-only in v1.
- Authentication, authorisation, TLS, and multi-user access. The viewer binds where it is told and assumes the operator controls who can reach it.
- Viewing more than one project at a time, or more than one map at a time.
- Rendering Markdown in step and goal bodies, or resolving artifact references to their targets.
- Crossing minimisation, manual node placement, or persisted layout.
- Virtualisation for very large maps; a few hundred steps is the working assumption.
- History, diffing between revisions, or any view of how a map changed over time.
- Shipping as a `wayful` subcommand. Whether the viewer belongs inside the CLI is an open question, not a decision this spec makes.

## Further Notes

- The prototype at `skills/wayful/prototype/` is a primary source, kept deliberately. It settled that the graph is the right primary view with board and list one tap away, that fit and readable are different zoom levels needing separate controls, and that the phone default has to be the board. Treat it as evidence; do not extend it into the implementation.
- The prototype invokes `bun cli/src/main.ts` directly, not the `cli/wayful` entrypoint, because that entrypoint hardcodes `/usr/bin/grep` and `/usr/bin/sed` and therefore cannot start on hosts without them. A shipped viewer that shells out to `wayful` depends on that being fixed first.
- One SSE stream per open tab consumes one of the browser's limited per-origin HTTP/1.1 connections. Several tabs on the same origin will stall each other. If the viewer moves beyond casual local use, this needs either HTTP/2 or a different change-notification transport.
- Shelling out per request is the right default — it keeps the CLI authoritative — but it costs a process spawn per command, and the project-scoped request spawns one per map. If that becomes slow, cache on the watcher's invalidation signal rather than reimplementing the model.
- The viewer makes gaps in the CLI's read surface visible. Project metadata has no command, and there is no single call that answers "the state of this map", which is why the server composes four. Both are candidates for CLI work rather than viewer work.
