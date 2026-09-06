# @wayful/ui — the Wayful viewer

A local, read-only web viewer for a Wayful project. It renders one map at a time
as a dependency graph, a status board, or a list, with a detail panel for the
selected step.

This is the baseline rebuild of `prototypes/viewer` as a real project:
React + Vite + TypeScript, Tailwind and shadcn/ui components, TanStack Router
and TanStack Query. `server.ts` is carried over from the prototype largely
intact — the client is what was rebuilt.

## Run it

```sh
# One process: the API plus the built client.
bun run build
bun run serve -- --project /path/to/repo --port 7830 --host 127.0.0.1

# Or, while developing the client: Vite on :7831 proxying /api to the server.
bun run serve -- --project /path/to/repo &
bun run dev
```

`server.ts` defaults `--project` to `$WAYFUL_PROJECT`, then the working
directory. `prototypes/viewer/seed-demo.sh` builds a scratch project to point it
at.

## The load-bearing constraint

**The CLI is the sole authority for domain state.** Every status, count,
readiness verdict and validity finding comes from `wayful … --json`; the client
computes only geometry. A number that is not in `--json` is not on screen, so
the viewer cannot disagree with `wayful` about a map.

| On screen                                | Source                            |
| ---------------------------------------- | --------------------------------- |
| Map cards in the rail                    | `map list` + `map status` per map |
| Start, goals, artifacts                  | `map show`                        |
| Step status, `ready` badge               | `map status` + `map next`         |
| Open findings                            | `map validate`                    |
| Step body, slots, live type instructions | `step show`                       |

`ready` is the one derived value, and it is display-only: a step whose `status`
is `pending` and whose ID appears in `map next`. Wayful's four persisted
statuses are untouched.

**Read-only.** The server never writes; it shells out to the CLI's read
commands, sets `WAYFUL_PROJECT` and clears `WAYFUL_MAP` so an ambient shell
value cannot select a different map.

## Layout of the source

| Path                      | What lives there                                        |
| ------------------------- | ------------------------------------------------------- |
| `src/lib/wayful.ts`       | The CLI's `--json` shapes, transcribed                  |
| `src/lib/api.ts`          | The three endpoints as TanStack Query options           |
| `src/lib/status.ts`       | The `ready` derivation and board grouping               |
| `src/lib/graph-layout.ts` | Longest-path layering and edge geometry                 |
| `src/lib/viewport.ts`     | Pan/zoom arithmetic, free of the DOM                    |
| `src/hooks/`              | Viewport gestures, SSE live updates, theme, breakpoints |
| `src/routes/`             | TanStack Router file routes                             |
| `src/components/ui/`      | shadcn components (owned source, not a dependency)      |

Which map, which view, whether cancelled steps show, and which step is selected
all live in the URL, so any state you can reach you can share or reload into.

## Tests

```sh
bun test
```

`src/lib/*` is pure and tested directly — layering for chains, fan-out, fan-in,
isolated and cancelled steps; the terminus edges; the `ready` derivation; and
the viewport's fit, legibility floor, zoom-about-pointer and pan constraints.

`test/app.test.tsx` drives the real router and components against a stubbed HTTP
surface — the same seam `server.ts` exposes — and asserts what a user can see.

## Known gaps against `SPEC.md`

- Each open tab holds one SSE connection, so several tabs on the same origin
  will exhaust the browser's HTTP/1.1 connection pool. Unchanged from the
  prototype.
- Layering is longest-path with no crossing minimisation, and nothing is
  virtualised. A few hundred steps is the working assumption.
- The graph transform is remembered per map rather than reset on every map
  change, so returning to a map returns to where you left it. The spec's
  narrower rule was "a change of key returns to the opening view".
- Not yet covered by tests: the responsive breakpoints, live-reload, and the
  read-only assertion over a real fixture tree. All three were verified by hand
  against `prototypes/viewer/demo-project`.
