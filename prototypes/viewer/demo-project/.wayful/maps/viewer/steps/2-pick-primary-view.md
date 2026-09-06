---
format_version: 1
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
completion_summary: Graph is primary; board and list stay one tap away.
---
Cheap artifact, one route, switchable. The question is which view a person reaches for first — not which one is prettiest.