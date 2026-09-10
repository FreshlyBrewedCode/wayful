#!/usr/bin/env bash
# Finds GitHub Project issues with Status=Ready, skips any with an open
# native blocker, and dispatches the rest — in the project's own column
# order — to a new t3ctl agent thread, moving each to In Progress so it
# isn't dispatched again.
#
# Env vars:
#   T3_PROJECT_ID   t3ctl project id for this workspace (required)
#   T3_PROVIDER     t3ctl provider (default: claudeAgent)
#   T3_MODEL        t3ctl model (default: claude-sonnet-5)
#   DRY_RUN         if "1", print what would happen instead of doing it
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

GH_OWNER="FreshlyBrewedCode"
GH_PROJECT_NUMBER=3
GH_PROJECT_ID="PVT_kwHOALOhUc4BjF7G"
STATUS_FIELD_ID="PVTSSF_lAHOALOhUc4BjF7Gzhh7jwY"
STATUS_IN_PROGRESS_OPTION_ID="8b34a1f4"

T3_PROJECT_ID="${T3_PROJECT_ID:?Set T3_PROJECT_ID to the t3ctl project id for this workspace}"
T3_PROVIDER="${T3_PROVIDER:-claudeAgent}"
T3_MODEL="${T3_MODEL:-claude-sonnet-5}"
DRY_RUN="${DRY_RUN:-0}"

PROMPT_TEMPLATE="$SCRIPT_DIR/ready-issue-prompt.md"

# orderBy: POSITION is the project's own manual ordering — the same order
# items appear top-to-bottom within a board column. issueDependenciesSummary
# is GitHub's native issue-dependencies gate (open blockers only).
ready_items=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        items(first: 100, orderBy: {field: POSITION, direction: ASC}) {
          nodes {
            id
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            content {
              __typename
              ... on Issue {
                number
                title
                issueDependenciesSummary { blockedBy }
              }
            }
          }
        }
      }
    }
  }' -f owner="$GH_OWNER" -F number="$GH_PROJECT_NUMBER" \
  --jq '.data.user.projectV2.items.nodes[]
    | select(.content.__typename == "Issue" and .fieldValueByName.name == "Ready")
    | [(.content.number | tostring), .id, (.content.issueDependenciesSummary.blockedBy | tostring), .content.title]
    | @tsv')

if [[ -z "$ready_items" ]]; then
  echo "No issues in Ready status."
  exit 0
fi

while IFS=$'\t' read -r issue_number item_id blocked_by issue_title; do
  [[ -z "$issue_number" ]] && continue

  if [[ "$blocked_by" != "0" ]]; then
    echo "Skipping issue #$issue_number (item $item_id): $blocked_by open blocker(s)"
    continue
  fi

  prompt="$(sed "s/{{ISSUE_NUMBER}}/$issue_number/g" "$PROMPT_TEMPLATE")"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] issue #$issue_number (item $item_id): $issue_title"
    echo "[dry-run]   would move Status -> In Progress"
    echo "[dry-run]   would run: t3ctl thread create --project $T3_PROJECT_ID --provider $T3_PROVIDER --model $T3_MODEL --title '[AUTO] #$issue_number: $issue_title' --prompt '$prompt'"
    continue
  fi

  echo "Moving issue #$issue_number (item $item_id) to In Progress"

  if ! gh project item-edit --project-id "$GH_PROJECT_ID" --id "$item_id" \
    --field-id "$STATUS_FIELD_ID" --single-select-option-id "$STATUS_IN_PROGRESS_OPTION_ID"; then
    echo "Could not move issue #$issue_number to In Progress (WIP limit?) — skipping dispatch" >&2
    continue
  fi

  echo "Dispatching issue #$issue_number"
  t3ctl thread create \
    --project "$T3_PROJECT_ID" \
    --provider "$T3_PROVIDER" \
    --model "$T3_MODEL" \
    --title "[AUTO] #$issue_number: $issue_title" \
    --prompt "$prompt"

done <<<"$ready_items"
