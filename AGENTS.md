Monorepo for the wayful system. `skills/wayful/SKILL.md` (or your wayful skill) describes the system.

- Bun is the primary runtime, package-, and workspace manager
- Run bun and any new tools needed in this project using`nix develop`

# Packages

- `packages/cli` - wayful CLI
  - EffectTS CLI
  - provides commands to interact with wayful primitives
    - provides different backends that define where wayful primitives are actually stored
  - bundles ui and server
- `packages/ui` - wayful UI
  - React SPA with Vite
  - Tanstack Router, Query
  - shadcn, tailwind

# Validation

- `bun check` to run everything
  - `bun test` (using buns test runner)
  - `bun typecheck` (typescript 7)
  - `bun lint` (oxlint, oxfmt)

- `bun wayful` run the wayful CLI from src

## Live browser validation

- Use `@playwright/cli` (the `playwright-cli` binary, a dev dependency) to drive a real browser against the running UI — e.g. after `bun --cwd packages/ui run dev`, `playwright-cli open http://localhost:<port>`, `snapshot`/`click`/`screenshot` to explore, then `close`.
- Must be run inside `nix develop`: the devshell adds the shared libraries (glib, gtk3, mesa/libgbm, X11 libs, etc.) that Playwright's downloaded Chromium needs to launch on NixOS, via `LD_LIBRARY_PATH`.

# Issue tracker

- GitHub issues

# Glossary

Wayful primitives, in one line each:

- **project** — outermost container, scoped to a directory; owns the step types, the backend, and many maps
- **map** — a start, one or more goals, and a graph of interdependent steps
- **goal** — a destination on a map; satisfied when its required output slots are filled
- **step** — a unit of work, like an issue: it describes work and records the result, it never performs it
- **step type** — a project-level schema for steps, declaring the slots a step inherits
- **artifact** — a ref (`file:docs/spec.md`, `https://…`) attached as a step input/output or a goal output; derived from those attachments, never stored on its own

Use `CONTEXT.md` for the full technical glossary (refs, slots, attachments, kinds, statuses, backends) and `docs/adr/` for the decisions behind them. `skills/wayful/SKILL.md` is the user-facing account of the same concepts; `CONTEXT.md` is canonical where they disagree.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (FreshlyBrewedCode/wayful), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Labels and workflow

Labels: `pkg:cli` / `pkg:ui` (which package), `type:bug` / `type:feature` (what kind). No dedicated triage labels — triage is a GitHub Project (Ready / In Progress / Blocked / Review); assigning an issue to it means it's ready for an agent. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
