You have been auto-assigned to GitHub issue #{{ISSUE_NUMBER}}. This is a non-interactive session.

- Inspect the issue
- Checkout a new branch `<feat/fix/refactor/chore>/##{{ISSUE_NUMBER}}-short-name` in a new worktree at `.worktrees/${{ISSUE_NUMBER}}-short-name`
- Implement the issue using the /implement skill and /tdd.
- Validate the implementation
- Create a PR
  - include "closes ${{ISSUE_NUMBER}}"
  - include a section describing the user-facing change (i.e. like a changelog)
    - if possible, include a <details> block with most relevant before and after examples
      - ui: screenshots
      - cli: example output
  - if the issue is dependant on other isses with open PRs: create a stacked PR using /gh-stack
  - watch CI, if red: /babysit the CI until green
