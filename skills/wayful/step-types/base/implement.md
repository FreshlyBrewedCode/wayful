---
format_version: 1
name: implement
description: Implement a feature or a change.  
required_inputs: 
  - name: spec
    kind: spec 
    description: A specification describing the feature or change 
required_outputs:
  - name: pr
    kind: pr-ref
    description: The pull request implementing the feature or change
---

1. Gather the required context from the step description and body, input specification and codebase.

2. Implement the feature or change using tdd (implement yourself)

3. Validate the implementation using testing

3. Orchestrate a code review and validation against the spec (review -> fix cycle pattern)

4. Create a PR and add as a step output
