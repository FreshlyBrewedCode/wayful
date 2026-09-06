---
format_version: 1
name: wayfinder-grilling
description: Resolve a decision through a live, structured conversation with the responsible human.
required_inputs: []
required_outputs:
  - name: resolution
    kind: wayfinder-resolution
    description: The decision record capturing the human's answer, rationale, and relevant consequences.
---

Use this HITL step for a decision that needs the responsible human's judgement.
It is the default Wayfinder step when the question is neither an external fact,
nor a question best answered by a concrete prototype, nor a prerequisite task.

Treat the step description and body as the question and current context. Call
both the `grilling` and `domain-modeling` skills. Work with the human until the
question has a clear answer; do not substitute an assumed human answer for the
conversation.

Record a resolution that gives the decision, its rationale, and the material
facts later steps need. Use the resolved decision to update the map: graduate
newly precise fog into dependent steps, retain remaining fog, and retire any
work that lies beyond the destination.
