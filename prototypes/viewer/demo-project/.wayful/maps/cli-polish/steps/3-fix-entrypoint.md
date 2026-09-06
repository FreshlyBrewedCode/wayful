---
format_version: 1
id: 3
name: fix-entrypoint
type: implement
description: Make the entrypoint portable and keep its diagnostics
status: pending
dependencies: 
  - 2
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
---
