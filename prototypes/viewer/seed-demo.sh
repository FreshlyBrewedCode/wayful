#!/usr/bin/env bash
# PROTOTYPE — throwaway. Rebuilds the demo Wayful project the viewer renders.
#
#   ./seed-demo.sh          # wipes ./demo-project/.wayful and re-seeds it
#
# All state here is scratch data. Delete demo-project/ at any time.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
CLI="$HERE/../../packages/cli/src/main.ts"
TYPES="$HERE/../../skills/wayful/step-types"
DEMO="$HERE/demo-project"

w() { bun "$CLI" "$@" >/dev/null; }

rm -rf "$DEMO"
mkdir -p "$DEMO"

export WAYFUL_PROJECT="$DEMO"

# `init` resolves --project/cwd only; it does not read WAYFUL_PROJECT.
w init --project "$DEMO" --description "Wayful viewer demo — scratch data for the UI prototype"

# Replace the generic seeded task type with the skill's real step types.
cp "$TYPES/base/"*.md "$DEMO/.wayful/types/"
cp "$TYPES/wayfinder/"*.md "$DEMO/.wayful/types/"

# ---------------------------------------------------------------- map: viewer
export WAYFUL_MAP=viewer

w map create --map viewer \
  --start "Wayful state is only readable through the CLI and raw files" \
  --goal "A human can understand a map's shape at a glance" \
  --goal-body "Success means someone who has never used Wayful can open the viewer and say what is done, what is next, and what is stuck — without reading \`.wayful\` by hand."

w goal add --name responsive --description "The viewer is usable on a phone" \
  --body "Single column below 720px, no horizontal scrolling except inside the graph canvas."

w artifact add cli-json-contract --kind research-findings --ref "skills/wayful/wayful_cli.spec.md#implementation-decisions"
w artifact add viewer-shape --kind wayfinder-resolution --ref "docs/decisions/viewer-shape.md"
w artifact add layout-sketch --kind prototype --ref "skills/wayful/prototype/server.ts"
w artifact add graph-notes --kind markdown --ref "docs/notes/graph-layout.md"

w step create survey-cli-json --type wayfinder-research \
  --description "Establish exactly which JSON the CLI already exposes" \
  --body "Read commands/map.ts and commands/step.ts. The viewer must not reimplement domain logic — if a number is not in \`--json\` output, it does not belong on screen."
w step output survey-cli-json --artifact cli-json-contract --slot findings
w step output survey-cli-json --artifact viewer-shape --slot resolution
w step complete survey-cli-json --summary "map show/status/next/validate and step show cover everything the viewer needs; no new CLI surface required."

w step create pick-primary-view --type wayfinder-prototype \
  --description "Decide whether the primary map view is a dependency graph, a status board, or a list" \
  --body "Cheap artifact, one route, switchable. The question is which view a person reaches for first — not which one is prettiest."
w step depends pick-primary-view --on survey-cli-json
w step output pick-primary-view --artifact layout-sketch --slot prototype
w step output pick-primary-view --artifact viewer-shape --slot resolution
w step complete pick-primary-view --summary "Graph is primary; board and list stay one tap away."

w step create layer-the-graph --type task \
  --description "Lay steps out by dependency depth so the path from start to goal reads left to right" \
  --body "Longest-path layering. Cancelled steps still occupy the graph — hiding them would hide why the map changed shape."
w step depends layer-the-graph --on pick-primary-view
w step output layer-the-graph --artifact graph-notes --slot resolution
w step complete layer-the-graph --summary "Layered DAG with orthogonal edges; cancelled steps rendered dimmed rather than dropped."

w step create step-detail-panel --type task \
  --description "Show a step's body, slots, attachments and live type instructions on selection"
w step depends step-detail-panel --on layer-the-graph

w step create mobile-pass --type task \
  --description "Make the whole viewer usable one-handed on a phone" \
  --body "Rail collapses to a sheet, graph gets its own pannable canvas, detail becomes a bottom drawer."
w step depends mobile-pass --on pick-primary-view

w step create live-reload --type task \
  --description "Reflect \`.wayful\` edits without a manual refresh" \
  --body "Watch the project directory and push an invalidation over SSE."
w step depends live-reload --on step-detail-panel
w step block live-reload --reason "Waiting on a decision about whether the viewer is read-only in v1"

w step create embed-in-cli --type implement \
  --description "Ship the viewer as \`wayful serve\`" \
  --body "Out of scope until the prototype earns its keep."
w step cancel embed-in-cli --reason "Prototype is throwaway; folding it into the CLI would make it production code by accident"

w goal satisfy --goal initial-goal --artifact viewer-shape --artifact layout-sketch

# ------------------------------------------------------------ map: cli-polish
export WAYFUL_MAP=cli-polish

w map create --map cli-polish \
  --start "CLI passes its own suite but assumes a Debian-shaped host" \
  --goal "The CLI runs on any POSIX host with a supported Bun" \
  --goal-body "The entrypoint should fail only when Bun is genuinely missing or too old."

w artifact add portability-findings --kind research-findings --ref "docs/research/entrypoint-portability.md"

w step create audit-entrypoint --type wayfinder-research \
  --description "Find every absolute path assumption in the shell entrypoint" \
  --body "The entrypoint hardcodes /usr/bin/grep and /usr/bin/sed. Neither exists on NixOS, so \`./wayful\` cannot start there and the whole test suite exits 127."
w step output audit-entrypoint --artifact portability-findings --slot findings

w step create decide-version-gate --type grilling \
  --description "Decide whether the Bun version gate stays in shell or moves into TypeScript"
w step depends decide-version-gate --on audit-entrypoint

w step create fix-entrypoint --type implement \
  --description "Make the entrypoint portable and keep its diagnostics"
w step depends fix-entrypoint --on decide-version-gate

# ------------------------------------------------------------- map: fresh-map
export WAYFUL_MAP=fresh-map

w map create --map fresh-map \
  --start "Nothing charted yet" \
  --goal "Something worth charting exists" \
  --goal-body "An empty map is a legitimate state. The viewer has to say so plainly instead of rendering an empty rectangle."

echo "Seeded $DEMO"
