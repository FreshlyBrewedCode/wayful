---
format_version: 1
name: grilling
description: Resolve a decision through a live, structured conversation.
required_inputs: []
required_outputs:
  - name: spec
    kind: spec 
    description: The record capturing all decisions in a specification
---

Treat the step description and body as the question and current context. Call
the `grilling` skill. Work with the human until the
question has a clear answer; do not substitute an assumed human answer for the
conversation.

Record a resolution that gives the decision, its rationale, and the material
facts later steps need summarized into a spec. Use the resolved decision to update the map: graduate
newly precise areas of uncertainity into dependent steps, and cancel any
steps that lie beyond the goal.
