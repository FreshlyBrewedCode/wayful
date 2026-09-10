---
status: accepted
---

# Artifact refs carry a scheme

A ref was a free-form opaque string, which left readers unable to tell whether
`docs/research/summary.md` was a file path, a document title, or an external identifier — a
distinction any tooling that wants to *do* something with a ref needs, and one that ADR-0004 makes
load-bearing by promoting the ref to the artifact's identity. Every ref now carries a scheme prefix
matching `^[a-z][a-z0-9+.-]*:`, and `file:` is the one scheme wayful assigns meaning to: a path
relative to the project root. Every other scheme (`https:`, `git:`, `pr:`) satisfies the grammar and
stays opaque, so this reserves a vocabulary without closing it.

## `file:` is deliberately not RFC 8089

Wayful's `file:` is project-relative; the standard scheme is absolute. A ref is therefore rejected
when the character after `file:` is `/`, which excludes both the authority form
(`file://host/path`) and the absolute form (`file:/etc/passwd`) with one rule and one error:

> `wayful: ref 'file:///home/me/notes.md' is not valid; wayful's file: refs are project-relative
> (e.g. 'file:docs/research/summary.md').`

`project:` or `repo:` would avoid the collision, but they name the *anchor* rather than the *type*
of thing referenced, and the type is what a scheme exists to declare. The collision is worth one
precise error message.

The split this draws — `file:` is interpreted, everything else is not — is what ADR-0004 normalizes
identity along and what ADR-0002 dereferences. Normalization of a `file:` ref belongs to ADR-0004,
which needs it for identity; this ADR governs only the grammar.

## Consequences

- Refs are validated wherever an attachment is written — `step input`, `step output` and their goal
  equivalents — so an invalid ref never reaches disk. There is no `artifact add` to validate at:
  ADR-0004 removes it.
- Records go to `format_version` 3, the same bump ADR-0004 makes, so the two land as one migration.
  An existing bare ref inside a step or goal attachment is no longer decodable.
- No migration tool ships. The skip-and-collect contract already reports an undecodable record
  per-file while its healthy siblings still read, so an old project degrades legibly in both the
  CLI and the viewer, and manual persistence editing is an intentional part of the design.
- Ref *existence* is still never validated. ADR-0002 covers where dereferencing is allowed and
  where it stops.
