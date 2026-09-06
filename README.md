# wayful

A Bun workspace monorepo for Wayful — a system for planning, orchestrating and
completing agentic work on flexible maps of interdependent steps.

## Layout

| Path | Contents |
| --- | --- |
| `skills/wayful/` | The `wayful` skill: `SKILL.md` and the `step-types/` library it describes |
| `prototypes/cli/` | The `wayful` CLI prototype, plus its spec (`SPEC.md`) |
| `prototypes/viewer/` | Read-only web viewer prototype, plus its spec (`SPEC.md`) |
| `packages/` | Empty — for extracted, non-throwaway packages |

Both entries under `prototypes/` are throwaway code, kept as-is from the skill
repository. `packages/` is where anything they prove out should graduate to.

## Getting started

Bun ≥ 1.4.1 is required. The flake's dev shell provides it:

```sh
nix develop
bun install
```

The dev shell pins the official Bun release binary rather than `pkgs.bun`,
which currently trails upstream and would fail the CLI's version gate. See the
comment in `flake.nix` for how to bump it.

## Running the prototypes

```sh
# CLI
./prototypes/cli/wayful --help
cd prototypes/cli && bun test

# Viewer — reads a project through the CLI, never writes
cd prototypes/viewer
./seed-demo.sh          # rebuild demo-project/ (scratch data)
bun server.ts           # http://localhost:7830
bun server.ts --project /path/to/repo --port 7830
```

## Known issue

`prototypes/cli/wayful` hardcodes `/usr/bin/grep` and `/usr/bin/sed`, so the
entrypoint and its test suite fail on hosts without a Debian-shaped `/usr/bin`
(NixOS, some containers). Invoking `bun prototypes/cli/src/main.ts` directly
works everywhere. This predates the move into this repository and is tracked by
the `cli-polish` map in the viewer's demo project.
