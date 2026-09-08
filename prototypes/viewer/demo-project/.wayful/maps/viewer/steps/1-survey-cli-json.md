---
format_version: 2
id: 1
name: survey-cli-json
type: wayfinder-research
description: Establish exactly which JSON the CLI already exposes
status: complete
dependencies: 
  []
inputs: 
  []
outputs: 
  - artifact: cli-json-contract
    slot: findings
  - artifact: viewer-shape
    slot: resolution
required_inputs: 
  []
required_outputs: 
  - name: findings
    kind: research-findings
    description: Durable findings with sources that answer the research question.
  - name: resolution
    kind: wayfinder-resolution
    description: The resolution record linking the findings and stating their consequence for the map.
created_at: 2026-09-08T17:48:44.034Z
updated_at: 2026-09-08T17:48:44.498Z
completion_summary: map show/status/next/validate and step show cover everything the viewer needs; no new CLI surface required.
closed_at: 2026-09-08T17:48:44.498Z
---
Read commands/map.ts and commands/step.ts. The viewer must not reimplement domain logic — if a number is not in `--json` output, it does not belong on screen.