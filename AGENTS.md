Monorepo for the wayful system. `skills/wayful/SKILL.md` (or your wayful skill) describes the system.

- Bun is the primary runtime, package-, and workspace manager
- Run bun and any new tools needed in this project using`nix develop`

# Packages

- `packages/cli` - wayful CLI
  - EffectTS CLI
  - bundles ui and server
- `packages/ui` - wayful UI (or "viewer")
  - React SPA with Vite
  - Tanstack Router, Query
  - shadcn, tailwind

# Validation

- `bun check` to run everything
  - `bun test` (using buns test runner)
  - `bun typecheck` (typescript 7)
  - `bun lint` (oxlint, oxfmt)

- `bun wayful` run the wayful CLI from src

# Issue tracker

- GitHub issues

# Glossary

- wayful primitives
  - project (has many maps)
  - maps (has start, goals, steps)
  - steps (like a ticket in an issue tracker, has a type, inputs, and outputs)
  - step type (like a schema for steps)
  - artifacts (scoped to a map, can be set as inputs/outputs of steps)

## Agent skills

### Issue tracker

Issues live in GitHub Issues (FreshlyBrewedCode/wayful), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Labels and workflow

Labels: `pkg:cli` / `pkg:ui` (which package), `type:bug` / `type:feature` (what kind). No dedicated triage labels — triage is a GitHub Project (Ready / In Progress / Blocked / Review); assigning an issue to it means it's ready for an agent. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
