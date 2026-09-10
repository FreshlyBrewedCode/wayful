---
status: accepted
---

# The backend allocates step ids

The CLI allocated step ids itself. `cli/commands/step.ts` read `step_id_counter` off the map's
metadata, checked it against the highest existing id, built the record around it and then called
`backend.setStepIdCounter` to advance it. Identity was therefore a command-layer concern, and the
counter was part of a map's public metadata rather than one backend's bookkeeping.

That only works for a store whose ids the caller can predict. A store that issues its own — a row
id, an issue number — cannot participate at all, because the id does not exist until the record
does. Creation now allocates: `createStep` takes a record with no `id` and returns the record it
created, and the counter machinery leaves the service interface entirely.

The same pattern held for artifacts; ADR-0004 removed it by removing artifact ids altogether, so
this decision is about steps alone.

## Ids are unique and ordered, not dense

The property the codebase actually relies on is ordering, not contiguity. `listSteps` sorts by id
and `nextSteps` sorts by id; nothing anywhere counts on ids being consecutive, small, or starting
at 1. The promise weakens accordingly — a step id is **unique within its map, stable, and
increasing with creation** — which a per-map counter and a repo-global issue number both satisfy.

The reference grammar is unaffected. `resolveToken` matches ids by equality, and `domain/reference.ts`
justifies its bare-integer-means-step rule from the fact that no *named* primitive may be purely
numeric — a fact about names, not about how ids are handed out.

## Rejected: keep the counter, let each backend maintain it

The counter could have stayed in map metadata, with a non-filesystem backend keeping its own. It was
rejected because allocating from a counter held in the record store means a read-modify-write with
no compare-and-set — for an issue-backed map, an issue body — so two concurrent creations can read
the same value and allocate the same id. A store that issues ids does so atomically. Borrowing that
guarantee is strictly safer than reimplementing it badly on top of a store that never offered it.

## Consequences

- `NewStepRecord` drops `id`, and `createStep` returns `StepRecord` instead of `void`. Every
  creation path now learns the id from the backend rather than deciding it.
- `setStepIdCounter` leaves `WayfulBackend`; `setArtifactIdCounter` left with ADR-0004. The
  filesystem backend advances its counter inside `createStep`, where the write it guards happens.
- `step_id_counter` leaves `MapMetadata` and becomes filesystem-private state in `map.toml`;
  `artifact_id_counter` is deleted outright.
- `domain/validate.ts`'s "step_id_counter must be greater than every existing step ID" check is
  deleted. It constrained a generator that now lives inside a single backend, which enforces it at
  write time instead — a rule about one implementation had no business in the pure domain layer.
- Records go to `format_version` 3, the same bump ADR-0001 and ADR-0004 make, so all three land as
  one migration rather than three.
- Step ids stop being comparable across projects that used to produce identical small integers. A
  map's steps may read `47`, `52`, `108`; documentation and examples that imply `1, 2, 3` need
  revisiting.
