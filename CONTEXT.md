# Wayful

Wayful is a system for planning and completing work whose destination is known but whose path is not. Work is organized on **maps**: a starting point, one or more **goals**, and a graph of interdependent **steps** that consume and produce **artifacts**. The map is charted as the work proceeds rather than fixed up front.

This glossary is the repo-level, technical vocabulary. `skills/wayful/SKILL.md` holds the user-facing account of the same concepts; where the two disagree, this file is canonical for how the system actually behaves.

## Language

### Work primitives

**Project**:
The outermost container, scoped to a directory. Owns the step types, the backend choice, and many maps.
_Avoid_: workspace, repository

**Map**:
The container for one body of work: a start, one or more goals, and a graph of steps that may depend on each other. A map may restrict which step types its steps can use, but nothing else about its shape is fixed in advance.
_Avoid_: plan, board, workflow, graph

**Start**:
A map's description of where the work begins. Free text, not a step.
_Avoid_: origin, baseline, entry point

**Goal**:
A named destination on a map, satisfied when every one of its required output slots is filled. A map has at least one; a goal has at least one required output slot.
_Avoid_: objective, outcome, acceptance criteria, definition of done

**Step**:
A unit of work on a map. A step *describes* work and records its result; it never performs the work, the same way an issue does not run itself.
_Avoid_: task, ticket, node, job, action

**Step type**:
A reusable schema for steps — a project-level Markdown file whose frontmatter declares the slots a step of that type inherits, and whose body is the instructions for doing the work. Types are hand-maintained and live only at project scope; a map can narrow the allowed set but never extend it.
_Avoid_: template, category, class

### Artifacts and attachments

**Artifact**:
A ref attached somewhere on a map, paired with a kind. An artifact has no record of its own: it is derived on every read from the attachments that carry its ref (ADR-0004), so it exists exactly as long as something references it.
_Avoid_: asset, document, deliverable, evidence

**Ref**:
The scheme-prefixed string that *is* an artifact's identity. `file:` is project-relative and the one scheme wayful interprets; every other scheme (`https:`, `git:`, `pr:`) satisfies the grammar and stays opaque (ADR-0001). Two refs that normalize to the same string are the same artifact.
_Avoid_: path, URL, link, identifier

**Attachment**:
The binding of a ref to a step's inputs or outputs, or to a goal's outputs. Exactly two shapes: *slot-bound* (`{slot, ref}`, inheriting its kind from the slot) or *supplementary* (`{ref, kind}`, naming its own kind because no slot fits).
_Avoid_: association, assignment, link

**Slot**:
A named, kinded requirement that a step or goal declares — the promise that something of a given kind will be supplied or produced. A slot is fulfilled by exactly one slot-bound attachment.
_Avoid_: field, parameter, requirement, port

**Kind**:
The free-form label for what an artifact is (`document`, `research-findings`, `markdown`). Reserved for artifacts: a *step* has a type, an *artifact* has a kind, and the two words are never swapped.
_Avoid_: type, format, category

**Dereference**:
Reading the content behind a ref. The readable set is closed — only a ref attached somewhere on the map can be dereferenced, and only Markdown `file:` refs resolve today (ADR-0002).
_Avoid_: fetch, load, open

### States and derived reads

**Status**:
A step's stored lifecycle state: `pending`, `blocked`, `complete`, or `cancelled`. Goals have no stored status.

**Blocked**:
A status a person or agent sets deliberately, with a reason, because the step cannot proceed. A step merely waiting on incomplete dependencies or unfilled inputs is *pending and not actionable* — not blocked.
_Avoid_: stuck, waiting, held

**Actionable**:
A pending step whose dependencies are all complete and whose required input slots are all filled. This is what `map next` returns, and it is guidance rather than a mandate.
_Avoid_: ready, available, unblocked, next

**Closed**:
Complete or cancelled. A closed step carries `closed_at` and rejects further edits.
_Avoid_: finished, done, archived

**Satisfied**:
A goal whose required output slots are all filled. Derived on every read and never stored, so a goal becomes satisfied the moment its last slot is filled — `goal satisfy` asserts that this has happened rather than causing it.
_Avoid_: complete, achieved, met, done

**Snapshot**:
Everything a map-scoped read is assembled from — map metadata, steps, goals, derived artifacts, and project types — retrieved in a single backend round trip.
_Avoid_: state, dump, view

### Addressing

**Reference**:
The grammar for addressing a map or a step in CLI input: `redesign`, `1`, `#1`, `#research-users`, `redesign/#1`. A bare integer is always a step id; a map prefix is addressing only and never crosses maps. Distinct from a *ref*, which addresses an artifact and is never map-qualified.
_Avoid_: ref, selector, locator

**Scope**:
The level a `context` read answers at: project, map, step, or artifact. Each scope answers "what's here, and what's next" for one primitive and what it connects to.
_Avoid_: level, layer, view

### Storage and surfaces

**Backend**:
Where a project's maps are stored — `filesystem` or `github`. It is a property of the project, recorded at init, not of the invocation. The split is deliberate: project configuration and step types are always on disk and in version control, while steps and goals route to the configured backend.
_Avoid_: store, driver, adapter, provider

**UI**:
The React SPA that renders a project's maps read-only, served by the CLI's embedded server and bundled into its binary.
_Avoid_: viewer, frontend, dashboard, app
