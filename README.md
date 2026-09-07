# wayful

A Bun workspace monorepo for Wayful — a system for planning, orchestrating and
completing agentic work on flexible maps of interdependent steps.

## Layout

| Path | Contents |
| --- | --- |
| `skills/wayful/` | The `wayful` skill: `SKILL.md` and the `step-types/` library it describes |
| `packages/cli/` | The `wayful` CLI, plus its spec (`SPEC.md`) |
| `packages/ui/` | The read-only viewer client, bundled and served by the CLI |
| `prototypes/viewer/` | Read-only web viewer prototype, plus its spec (`SPEC.md`) |

Everything under `prototypes/` is throwaway code, kept as-is from the skill
repository and excluded from lint, format, and typecheck. `packages/` is where
anything a prototype proves out graduates to.

## Getting started

Bun ≥ 1.4.1 is required. The flake's dev shell provides it:

```sh
nix develop
bun install
```

The dev shell pins the official Bun release binary rather than `pkgs.bun`,
which currently trails upstream and does not yet provide the `Bun.YAML` and
`Bun.TOML` stringify APIs the CLI depends on. See the comment in `flake.nix`
for how to bump it.

## Checks

```sh
bun run build       # build packages/ui and bundle it into packages/cli
bun run check       # lint + typecheck + test
bun run lint        # oxfmt --check + oxlint
bun run format      # oxfmt, writing in place
bun run typecheck   # tsc --noEmit per package
bun run test        # bun test per package
```

## Running

```sh
# CLI — bun install links it as node_modules/.bin/wayful
./node_modules/.bin/wayful --help
bun packages/cli/src/main.ts --help

# Viewer — the CLI serves both the API and the bundled client, and never writes
bun run build                                   # bundle packages/ui into the CLI
wayful ui --project /path/to/repo               # http://127.0.0.1:7830
wayful serve --project /path/to/repo            # the same API, no client

# Scratch data to point either at
cd prototypes/viewer && ./seed-demo.sh          # rebuild demo-project/
```
