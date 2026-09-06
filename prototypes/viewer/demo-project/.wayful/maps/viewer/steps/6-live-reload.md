---
format_version: 1
id: 6
name: live-reload
type: task
description: "Reflect `.wayful` edits without a manual refresh"
status: blocked
dependencies: 
  - 4
inputs: 
  []
outputs: 
  []
required_inputs: 
  []
required_outputs: 
  - name: resolution
    kind: markdown
    description: A description of how the task was resolved
block_reason: Waiting on a decision about whether the viewer is read-only in v1
---
Watch the project directory and push an invalidation over SSE.