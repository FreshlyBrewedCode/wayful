# Wayful viewer — PROTOTYPE

Throwaway code. Not part of the `wayful` skill or CLI, not on any path the CLI
imports, and not meant to be merged into `main` as-is.

**The question it answers:** what does a Wayful project look like when you can
see it? Specifically — can someone who has never used Wayful open a map and say
what is done, what is next, and what is stuck, without reading `.wayful` by
hand?

## Run it

```sh
bun server.ts                        # serves the bundled demo project
bun server.ts --project /path/to/repo --port 7830 --host 0.0.0.0
```

Requires Bun ≥ 1.4.1 (same baseline as the CLI — `Bun.TOML.stringify`).

`./seed-demo.sh` rebuilds `demo-project/` from scratch through the real CLI.
Everything in there is scratch data; delete it freely.

## What it shows

| Region | Source |
| --- | --- |
| Map cards in the rail | `wayful map list` + `wayful map status` per map |
| Start / goals / artifacts | `wayful map show` |
| Step status, `ready` badge | `wayful map status` + `wayful map next` |
| Open findings | `wayful map validate` |
| Step body, slots, instructions | `wayful step show` |

Three views over the same map: **Graph** (steps laid out by dependency depth,
start on the left, goal post on the right), **Board** (grouped by status), and
**List**. Selecting a step opens its body, its required input/output slots with
fulfilment state, its neighbours in the graph, and the *live* instructions
resolved from its type file.

The canvas runs flush to the left, right and bottom of the main column — the
view switcher and the cancelled-steps toggle float over its top corners, the
zoom HUD over its bottom-right. Board and List keep a gutter and clear the
overlay.

The graph canvas is a pan/zoom viewport:

| Gesture | Effect |
| --- | --- |
| Drag | Pan. A drag that ends on a step does not select it. |
| Wheel / trackpad | Zoom about the cursor |
| Two-finger pinch | Zoom about the midpoint |
| Two-finger swipe (with horizontal component) | Pan |
| `−` / `+` / `Fit` | Zoom out, in, or frame the whole map |
| Click the percentage | Reset to 100% |

It opens at whichever zoom fits, floored at 55% so labels stay readable — pan
for the rest. `Fit` is the honest bird's-eye and will go below that. Panning
survives re-renders (selecting a step, a live-reload push); changing map resets
it. Tabbing to an off-screen step pans it into view.

## Deliberate constraints

- **Read-only.** The server never writes. It shells out to
  `../cli/src/main.ts <cmd> --json` and forwards the result.
- **No domain logic in the client.** Status, readiness and validity are the
  CLI's answers. The only thing computed here is *layout* — which column a step
  sits in. If a number is not in `--json`, it is not on screen.
- **No build step, no dependencies.** Three static files and one Bun server.

## Known rough edges

- `.wayful` is watched and pushed over SSE. Each open tab holds one SSE
  connection, so ~6 tabs on the same origin will exhaust Chrome's HTTP/1.1
  connection pool and later requests stall. Fine for one or two tabs.
- Artifact detail is an `alert()`.
- The graph canvas sets `touch-action: none`, so on a phone a touch drag over it
  pans the graph rather than scrolling the page. Scroll from outside the canvas.
- The graph layer assignment is longest-path with no crossing minimisation.
  Wide fan-out maps will have edges crossing.
- Nothing is virtualised; a few hundred steps will get slow.
