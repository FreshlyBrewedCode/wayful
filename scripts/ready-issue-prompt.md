You have been auto-assigned to GitHub issue #{{ISSUE_NUMBER}}. This is a non-interactive session.

- Inspect the issue
- Checkout a new branch `<feat/fix/refactor/chore>/{{ISSUE_NUMBER}}-<short-name>` in a new worktree at `.worktrees/{{ISSUE_NUMBER}}-<short-name>`
  - check if the issue has any dependency issues/PRs that you need to base your work on
  - if the issue has dependencies that do not have PRs yet (clearly missing pre-requisite work), set the issue status in the "Wayful" GitHub project to "Blocked" and stop working
- Implement the issue using the /implement skill and /tdd.
- Validate the implementation
- Create a PR
  - include "closes #{{ISSUE_NUMBER}}"
  - include a section describing the user-facing change (i.e. like a changelog)
    - if possible, include a <details> block with most relevant before and after examples
      - ui: screenshots
      - cli: example output
  - if the issue is dependant on other isses with open PRs: create a stacked PR using /gh-stack
  - watch CI, if red: /babysit the CI until green
