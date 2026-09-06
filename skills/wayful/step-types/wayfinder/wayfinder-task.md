---
format_version: 1
name: wayfinder-task
description: Complete a prerequisite action that unblocks a later decision.
required_inputs: []
required_outputs:
  - name: result
    kind: task-result
    description: Evidence or a durable record of the completed prerequisite action.
  - name: resolution
    kind: wayfinder-resolution
    description: The record of what was done and the facts later decisions depend on.
---

Use this step when no decision, research, or prototype can proceed until a
concrete prerequisite action happens: access must be provisioned, an account
created, data moved, or another condition made observable. Its purpose is to
unblock a decision, not to deliver the map's destination.

Carry out the action autonomously when possible. When a human must act, provide
the precise checklist they need and wait for their confirmation. Record a result
artifact and a resolution that states what was done, where any durable outputs
live, and the facts or constraints the next decision needs.

Once complete, make the newly unblocked decision actionable and update the map
only where the result has made its next questions precise.
