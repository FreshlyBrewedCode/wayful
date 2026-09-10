---
status: accepted
---

# Markdown rendering is sanitized by construction

The viewer renders markdown it did not write — artifact content, step bodies, goal bodies and type
instructions all come from a repository or an agent — and it does so on the same origin as an API
that can read files from the project (ADR-0002). An injection in the renderer is therefore a file
disclosure, not a defacement. The viewer uses `react-markdown` with `remark-gfm` specifically
because its unsafe path is opt-in: raw HTML is dropped unless `rehype-raw` is added, and dangerous
URL protocols are stripped by default.

This is recorded as a decision rather than left to the code because reversing it is one dependency
and one line — someone wanting an inline `<details>` block will not think of themselves as
disabling a security control, and will not be reading the server's ADR when they do it.

## The rules

- **`rehype-raw` is never added.** If a feature needs raw HTML, it needs a different design.
- **Link protocols** are limited to `http`, `https` and `mailto`; external links get
  `rel="noopener noreferrer"`.
- **Relative images are not resolved.** Serving them means a byte-serving endpoint for files that
  are not attached anywhere, which breaks ADR-0002's invariant. Alt text renders instead.
- **No syntax highlighting** in the first cut. Shiki and Prism are large, and the viewer bundle is
  embedded into the CLI binary.

## Consequences

One renderer serves every markdown surface in the viewer, which retires the note in
`step-detail-panel.tsx` that bodies and instructions are plain text. Step bodies, goal bodies and
type instructions are markdown on disk and have always rendered as preformatted text; they now
render as what they are.
