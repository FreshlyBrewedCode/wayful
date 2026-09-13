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
  - if the PR does not target `main`, link it to the issue explicitly (see below)
  - watch CI, if red: /babysit the CI until green

## Linking a stacked PR to its issue

GitHub only honours the `closes #{{ISSUE_NUMBER}}` keyword when the PR targets the
default branch. A stacked PR targeting another branch stays unlinked, and the
dispatcher will treat every issue that depends on this one as still blocked. So
after creating a PR whose base is not `main`, link it explicitly:

```sh
# $PR is the new pull request number
gh api graphql -f query='
  mutation($issue: ID!, $prs: [ID!]!) {
    addCloseIssueReferences(input: {issueId: $issue, pullRequestIds: $prs}) {
      issue { number closedByPullRequestsReferences(first: 10) { nodes { number state } } }
    }
  }' \
  -f issue="$(gh issue view {{ISSUE_NUMBER}} --json id --jq .id)" \
  -f prs="$(gh pr view "$PR" --json id --jq .id)"
```

The mutation takes node IDs, not numbers, which is what the two `gh` sub-shells
resolve. It works regardless of base branch. Check the returned
`closedByPullRequestsReferences` contains the PR — that is the same field the
dispatcher reads. Keep the `closes #{{ISSUE_NUMBER}}` line in the body as well,
so the issue still closes automatically once the stack lands on `main`.

To undo a link, use `removeCloseIssueReferences` with the same inputs. It only
works while the issue is open.
