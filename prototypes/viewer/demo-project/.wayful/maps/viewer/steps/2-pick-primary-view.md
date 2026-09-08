---
format_version: 2
id: 2
name: pick-primary-view
type: wayfinder-prototype
description: "Decide whether the primary map view is a dependency graph, a status board, or a list"
status: complete
dependencies: 
  - 1
inputs: 
  []
outputs: 
  - artifact: layout-sketch
    slot: prototype
  - artifact: viewer-shape
    slot: resolution
required_inputs: 
  []
required_outputs: 
  - name: prototype
    kind: prototype
    description: The rough artifact the human reviewed.
  - name: resolution
    kind: wayfinder-resolution
    description: The decision record describing what the human selected or changed.
created_at: 2026-09-08T17:48:44.652Z
updated_at: 2026-09-08T17:48:45.262Z
completion_summary: Graph is primary; board and list stay one tap away.
closed_at: 2026-09-08T17:48:45.262Z
---
Cheap artifact, one route, switchable. The question is which view a person reaches for first — not which one is prettiest.