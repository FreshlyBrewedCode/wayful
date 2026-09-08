---
format_version: 2
id: 3
name: layer-the-graph
type: task
description: Lay steps out by dependency depth so the path from start to goal reads left to right
status: complete
dependencies: 
  - 2
inputs: 
  []
outputs: 
  - artifact: graph-notes
    slot: resolution
required_inputs: 
  []
required_outputs: 
  - name: resolution
    kind: markdown
    description: A description of how the task was resolved
created_at: 2026-09-08T17:48:45.415Z
updated_at: 2026-09-08T17:48:45.880Z
completion_summary: Layered DAG with orthogonal edges; cancelled steps rendered dimmed rather than dropped.
closed_at: 2026-09-08T17:48:45.880Z
---
Longest-path layering. Cancelled steps still occupy the graph — hiding them would hide why the map changed shape.