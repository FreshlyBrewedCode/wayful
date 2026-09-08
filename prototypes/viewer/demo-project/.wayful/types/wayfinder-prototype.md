---
format_version: 2
name: wayfinder-prototype
description: Use a cheap concrete artifact to resolve a design or behaviour decision with a human.
required_inputs: []
required_outputs:
  - name: prototype
    kind: prototype
    description: The rough artifact the human reviewed.
  - name: resolution
    kind: wayfinder-resolution
    description: The decision record describing what the human selected or changed.
---

Use this HITL step when the question is best answered by reacting to something
concrete: how an interface should look, how logic should behave, or what shape
an outline or stub should take.

Treat the step description and body as the question, constraints, and intended
human. Create a deliberately cheap artifact with the `prototype` skill, present
it to the human who can make the decision, and revise it only as far as needed
to reach that decision. The human supplies the judgement; the prototype makes
that judgement easier.

Record both the reviewed prototype and a resolution that links it, states the
decision, and identifies consequences for the map. Then create or sharpen only
the follow-up steps that the decision has made specifiable.
