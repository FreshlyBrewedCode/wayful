---
format_version: 1
id: 1
name: audit-entrypoint
type: wayfinder-research
description: Find every absolute path assumption in the shell entrypoint
status: pending
dependencies: 
  []
inputs: 
  []
outputs: 
  - artifact: portability-findings
    slot: findings
required_inputs: 
  []
required_outputs: 
  - name: findings
    kind: research-findings
    description: Durable findings with sources that answer the research question.
  - name: resolution
    kind: wayfinder-resolution
    description: The resolution record linking the findings and stating their consequence for the map.
---
The entrypoint hardcodes /usr/bin/grep and /usr/bin/sed. Neither exists on NixOS, so `./wayful` cannot start there and the whole test suite exits 127.