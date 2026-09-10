#!/usr/bin/env bash
# Finds GitHub Project issues with Status=Ready, skips any with an open
# native blocker, and dispatches the rest — in the project's own column
# order — to a new t3ctl agent thread, moving each to In Progress so it
# isn't dispatched again.
#
# Env vars:
#   T3_PROJECT_ID       t3ctl project id for this workspace (required)
#   T3_PROVIDER         t3ctl provider (default: claudeAgent)
#   T3_MODEL            t3ctl model (default: claude-sonnet-5)
#   DRY_RUN             if "1", print what would happen instead of doing it
#   RUN_UNTIL_EMPTY     if "1", reschedule itself (via `at`) to run again
#                       after RUN_INTERVAL_MINUTES, until the Ready column
#                       is empty
#   RUN_INTERVAL_MINUTES  minutes between reschedules (default: 15)
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"

GH_OWNER="FreshlyBrewedCode"
GH_PROJECT_NUMBER=3
GH_PROJECT_ID="PVT_kwHOALOhUc4BjF7G"
STATUS_FIELD_ID="PVTSSF_lAHOALOhUc4BjF7Gzhh7jwY"
STATUS_IN_PROGRESS_OPTION_ID="8b34a1f4"

# T3_PROJECT_ID="${T3_PROJECT_ID:?Set T3_PROJECT_ID to the t3ctl project id for this workspace}"
# T3_PROVIDER="${T3_PROVIDER:-claudeAgent}"
# T3_MODEL="${T3_MODEL:-claude-sonnet-5}"
# DRY_RUN="${DRY_RUN:-0}"
T3_PROJECT_ID="4a028c8e-c65f-43cf-ac36-3cc3600e4f15" # wayful
T3_PROVIDER="claudeAgent"
T3_MODEL="claude-sonnet-5"
DRY_RUN="0"

PROMPT_TEMPLATE="$SCRIPT_DIR/ready-issue-prompt.md"

# orderBy: POSITION is the project's own manual ordering — the same order
# items appear top-to-bottom within a board column. blockedBy walks GitHub's
# native issue-dependencies edges (open blockers only). A blocker whose open
# blockers each already have an open linked PR (closedByPullRequestsReferences,
# i.e. a PR with a closing keyword — merge not required) doesn't count as a
# hard block; anything else does.
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
                blockedBy(first: 20) {
                  nodes {
                    number
                    state
                    closedByPullRequestsReferences(first: 10) {
                      nodes { number state }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }' -f owner="$GH_OWNER" -F number="$GH_PROJECT_NUMBER" \
  --jq '.data.user.projectV2.items.nodes[]
    | select(.content.__typename == "Issue" and .fieldValueByName.name == "Ready")
    | . as $item
    | ($item.content.blockedBy.nodes // []) as $blockers
    | ($blockers | map(select(.state == "OPEN"))) as $openBlockers
    | ($openBlockers | map(select((.closedByPullRequestsReferences.nodes // []) | map(select(.state == "OPEN")) | length == 0))) as $hardBlockers
    | [
        ($item.content.number | tostring),
        $item.id,
        (if ($hardBlockers | length) > 0 then "1" else "0" end),
        ($hardBlockers | map("#" + (.number | tostring)) | join(",") | if . == "" then "-" else . end),
        ($openBlockers | map("#" + (.number | tostring)) | join(",") | if . == "" then "-" else . end),
        $item.content.title
      ]
    | @tsv')

if [[ -z "$ready_items" ]]; then
  echo "No issues in Ready status."
  exit 0
fi

schedule_next_run() {
  local interval="${RUN_INTERVAL_MINUTES:-15}"
  echo "Ready column not yet empty — scheduling next run in ${interval} minute(s) via at"
  at now + "$interval" minutes <<EOF
RUN_UNTIL_EMPTY="$RUN_UNTIL_EMPTY" RUN_INTERVAL_MINUTES="$interval" "$SCRIPT_PATH"
EOF
}

while IFS=$'\t' read -r issue_number item_id hard_blocked hard_blockers open_blockers issue_title; do
  [[ -z "$issue_number" ]] && continue

  if [[ "$hard_blocked" == "1" ]]; then
    echo "Skipping issue #$issue_number (item $item_id): blocked by $hard_blockers (no open PR yet)"
    continue
  fi

  if [[ "$open_blockers" != "-" ]]; then
    echo "Issue #$issue_number (item $item_id): blocker(s) $open_blockers still open but have an open PR — treating as unblocked"
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

if [[ "${RUN_UNTIL_EMPTY:-0}" == "1" ]]; then
  schedule_next_run
fi
