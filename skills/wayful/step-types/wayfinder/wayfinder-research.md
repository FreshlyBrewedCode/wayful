---
format_version: 1
name: wayfinder-research
description: Resolve a decision-blocking question through independent research.
required_inputs: []
required_outputs:
  - name: findings
    kind: research-findings
    description: Durable findings with sources that answer the research question.
  - name: resolution
    kind: wayfinder-resolution
    description: The resolution record linking the findings and stating their consequence for the map.
---

Use this AFK step when a decision depends on facts outside the current working
directory: third-party documentation, an external API, or a knowledge base.

Treat the step description and body as the question and its scope. Resolve the
question with the `research` skill. Record the source-backed findings as an
artifact, rather than treating an unsupported conclusion as a finding. Create a
resolution record that links the findings, gives the answer, and states which
decision it enables. Its reference may be the tracker resolution comment,
research document, or another durable record.

On completion, reconsider the map: add only newly sharp questions as dependent
steps; leave still-vague in-scope work as fog. Attach the resolution artifact to
later steps that need its answer.
