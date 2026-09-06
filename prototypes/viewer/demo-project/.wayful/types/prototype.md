---
format_version: 1
name: prototype
description: Use a cheap concrete artifact to resolve a design or behaviour decision with a human.
required_inputs: []
required_outputs:
  - name: prototype
    kind: prototype-ref
    description: The rough artifact the human reviewed.
  - name: resolution
    kind: markdown
    description: The decision record describing what the human selected or changed.
---

Treat the step description and body as the question, constraints, and context. Create a deliberately cheap artifact with the `prototype` skill, present
it to the human who can make the decision, and revise it only as far as needed
to reach that decision. The human supplies the judgement; the prototype makes
that judgement easier.

Record both the reviewed prototype and a resolution that links it, states the
decision, and identifies consequences for the map. Then create or sharpen only
the follow-up steps that the decision has made specifiable.

If you create any follow-up steps that rely on the insights gained from the prototype, link the prototype artifact as an input for that step.
