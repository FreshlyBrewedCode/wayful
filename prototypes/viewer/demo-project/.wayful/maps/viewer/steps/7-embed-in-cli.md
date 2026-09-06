---
format_version: 1
id: 7
name: embed-in-cli
type: implement
description: "Ship the viewer as `wayful serve`"
status: cancelled
dependencies: 
  []
inputs: 
  []
outputs: 
  []
required_inputs: 
  - name: spec
    kind: spec
    description: A specification describing the feature or change
required_outputs: 
  - name: pr
    kind: pr-ref
    description: The pull request implementing the feature or change
cancellation_reason: Prototype is throwaway; folding it into the CLI would make it production code by accident
---
Out of scope until the prototype earns its keep.