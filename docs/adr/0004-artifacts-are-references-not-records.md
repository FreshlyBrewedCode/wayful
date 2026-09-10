---
status: accepted
---

# Artifacts are references, not records

An artifact was a map-local record — `id`, `name`, `kind`, `ref` and timestamps, stored one per file
under a map's `artifacts` directory — that step attachments and goal evidence referred to by name.
Because a ref is never dereferenced to check that anything is there, that record registered
*metadata about a pointer*: `artifact add` asserted a thing existed, and `step input` then asserted
that the assertion had been made. One layer of assertion is enough. The record dissolves into the
attachment that uses it, and an attachment now carries its ref directly:

- **Slot-bound**: `{slot, ref}`. The slot already declares the kind, so the attachment never
  restates it — which is what makes a wrong kind in a slot unrepresentable rather than merely
  reported.
- **Supplementary**: `{ref, kind}`. There is no slot to inherit a kind from, so the attachment
  names its own.

Attachments stay `readonly unknown[]` on the record and keep being diagnosed by
`domain/graph.ts`'s `attachmentErrors`, so a hand-edited malformed entry is still reported rather
than silently dropped.

## Goals attach outputs, not evidence

A goal's `evidence` was a list of artifact names, and with no names left to list it has to become
something else. It becomes the pair steps already have: `outputs` and `required_outputs`. This is a
unification rather than a port — `attachmentOK` and `attachmentErrors` stop being step-specific and
generalize to any record carrying slots and attachments.

A goal has no type to snapshot slots from, so it declares them at `goal add`, using the same slot
shape and the same `--required-outputs` flag as a step. It must declare at least one: `.every()`
over an empty array is `true`, so a goal with no required output would be satisfied the moment it
was created, and `map create`'s initial goal would arrive already met. `map create` therefore gives
its initial goal a default slot.

`goal satisfy` stops storing evidence. It verifies every required output slot is filled and then
closes the goal — the same shape as `step complete`, and for the same reason: satisfaction is a
recorded transition, gated by slots rather than derived from them.

## Identity is the normalized ref

With no record there is no `id` and no name to address, so an artifact's identity is its ref, split
along the line ADR-0001 draws. A `file:` ref is one wayful assigns meaning to, so it is normalized
on write — `./` stripped, `//` collapsed — and a canonical form is what reaches disk. Every other
scheme stays opaque and compares byte-exact after trimming; normalizing an `https:` host or port
would mean parsing a ref that ADR-0001 deliberately leaves unparsed.

The reverse index keys on the ref alone. The same document attached as `spec` in one step and
`prior-art` in another is one artifact filling two roles, not two artifacts.

## Rejected: give artifacts a body

Letting an artifact carry its own content was considered, because a comment or a record holding
only metadata reads as noise. It was rejected: a pull request has no body wayful could own, and a
primitive that is sometimes a pointer and sometimes a container is worse than either one. Content
lives behind the ref, wherever that is, and ADR-0002 is how a reader gets to it.

## Consequences

- Records go to `format_version` 3 — the same bump ADR-0001 makes, so the two land as one
  migration. No migration tool ships, for ADR-0001's reasons: skip-and-collect reports an
  undecodable record per file while its healthy siblings still read.
- Four rules are deleted rather than reimplemented. A missing artifact and a wrong kind for a slot
  both become structurally impossible; re-satisfying a satisfied goal is already covered by the
  existing duplicate-slot rejection; and the `.yml`/`.yaml` collision rule has nothing left to
  govern, since artifacts no longer have files.
- The reference grammar loses the `@` sigil, artifact tokens and `expectArtifact`. Only maps and
  steps stay addressable.
- `WayfulBackend` loses `listArtifacts`, `createArtifact` and `setArtifactIdCounter`. `artifact add`
  goes; `artifact list` and `artifact show` become derived reads over a map's attachments instead
  of a stored collection, which also means they report artifacts actually in use rather than
  orphaned registrations.
- ADR-0002's invariant — *only through its record* — has no record left to name. Its substance
  holds: the readable set is still closed and derived from project data, now "every ref attached on
  this map", and the security argument is unchanged, since adding a readable file took one
  deliberate act before and takes one now. Its endpoint addressed an artifact by name
  (`?ref=@user-interviews`) and needs a new handle; a content address over the normalized ref keeps
  its *no request ever names a path* property literally true.
- Refs render as themselves. Losing `@user-interviews` in favour of `file:docs/user-interviews.md`
  is the intended trade — for an external artifact the URL was always more informative than a
  nickname.
- A non-filesystem backend has no artifact storage to design. There is no artifact record to find a
  home for, only refs inside step and goal records.
