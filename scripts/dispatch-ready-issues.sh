#!/usr/bin/env bash
# Finds GitHub Project issues with Status=Ready, skips any with an open
# native blocker, and dispatches the rest — in the project's own column
# order — to a new t3ctl agent thread, moving each to In Progress so it
# isn't dispatched again.
#
# Before dispatching, the script checks for failed automatically-created
# threads (titles starting with "[AUTO]"). While any exist, no new issues
# are dispatched. For each failed auto thread it sends the one-word prompt
# "continue" using exponential backoff based on RUN_INTERVAL_MINUTES.
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
#   DISPATCH_RETRY_STATE  path to the retry-state TSV used for failed auto
#                         threads (default: <script dir>/.dispatch-retries.tsv)
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"

GH_OWNER="FreshlyBrewedCode"
GH_PROJECT_NUMBER=3
GH_PROJECT_ID="PVT_kwHOALOhUc4BjF7G"
STATUS_FIELD_ID="PVTSSF_lAHOALOhUc4BjF7Gzhh7jwY"
STATUS_IN_PROGRESS_OPTION_ID="8b34a1f4"

T3_PROJECT_ID="${T3_PROJECT_ID:-4a028c8e-c65f-43cf-ac36-3cc3600e4f15}" # wayful
T3_PROVIDER="${T3_PROVIDER:-claudeAgent}"
T3_MODEL="${T3_MODEL:-claude-sonnet-5}"
DRY_RUN="${DRY_RUN:-0}"

PROMPT_TEMPLATE="$SCRIPT_DIR/ready-issue-prompt.md"
RETRY_STATE_FILE="${DISPATCH_RETRY_STATE:-$SCRIPT_DIR/.dispatch-retries.tsv}"


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

schedule_retry_check() {
  local interval="$1"
  echo "Failed automatic thread(s) remain — scheduling retry check in ${interval} minute(s) via at"
  at now + "$interval" minutes <<EOF
RUN_UNTIL_EMPTY="$RUN_UNTIL_EMPTY" RUN_INTERVAL_MINUTES="${RUN_INTERVAL_MINUTES:-15}" "$SCRIPT_PATH"
EOF
}

clean_retry_state() {
  if [[ ! -f "$RETRY_STATE_FILE" ]]; then
    return 0
  fi
  local tmp_file="${RETRY_STATE_FILE}.tmp"
  local thread_id count last status
  while IFS=$'\t' read -r thread_id count last; do
    [[ -z "$thread_id" ]] && continue
    status=$(t3ctl thread status "$thread_id" 2>/dev/null || echo "unknown")
    if [[ "$status" == "failed" ]]; then
      printf '%s\t%s\t%s\n' "$thread_id" "$count" "$last"
    fi
  done < "$RETRY_STATE_FILE" > "$tmp_file"
  mv "$tmp_file" "$RETRY_STATE_FILE"
}

get_retry_state() {
  local thread_id="$1"
  if [[ -f "$RETRY_STATE_FILE" ]]; then
    awk -F'\t' -v id="$thread_id" '
      $1 == id {print $2 "\t" $3; found=1}
      END {if (!found) print "0\t0"}
    ' "$RETRY_STATE_FILE"
  else
    echo "0	0"
  fi
}

record_retry() {
  local thread_id="$1"
  local count last now
  read -r count last < <(get_retry_state "$thread_id")
  count=$((count + 1))
  now=$(date +%s)
  local tmp_file="${RETRY_STATE_FILE}.tmp"
  if [[ -f "$RETRY_STATE_FILE" ]]; then
    awk -F'\t' -v id="$thread_id" -v c="$count" -v n="$now" '
      BEGIN {OFS="\t"}
      $1 == id {print id, c, n; done=1; next}
      {print}
      END {if (!done) print id, c, n}
    ' "$RETRY_STATE_FILE" > "$tmp_file"
  else
    printf '%s\t%s\t%s\n' "$thread_id" "$count" "$now" > "$tmp_file"
  fi
  mv "$tmp_file" "$RETRY_STATE_FILE"
}

is_retry_due() {
  local thread_id="$1" base_minutes="$2"
  local count last now elapsed backoff
  read -r count last < <(get_retry_state "$thread_id")
  count=${count:-0}
  last=${last:-0}
  now=$(date +%s)
  elapsed=$(( (now - last) / 60 ))
  backoff=$(( base_minutes * (2 ** count) ))
  if [[ $backoff -gt 1440 ]]; then
    backoff=1440
  fi
  [[ $elapsed -ge $backoff ]]
}

handle_failed_auto_threads() {
  local base_interval="${RUN_INTERVAL_MINUTES:-15}"
  local thread_id title status count last now elapsed backoff remaining
  local -a failed_threads=()
  local max_wait=0
  local list_output

  clean_retry_state

  if ! list_output=$(t3ctl thread list --project "$T3_PROJECT_ID" 2>/dev/null); then
    echo "Could not list t3ctl threads; aborting to avoid dispatching while failed auto threads may exist" >&2
    exit 1
  fi

  while IFS=$'\t' read -r thread_id _ title; do
    [[ -z "$thread_id" ]] && continue
    [[ "$title" != "[AUTO]"* ]] && continue
    status=$(t3ctl thread status "$thread_id" 2>/dev/null || echo "unknown")
    if [[ "$status" == "failed" ]]; then
      failed_threads+=("$thread_id")
    fi
  done <<<"$list_output"

  if [[ ${#failed_threads[@]} -eq 0 ]]; then
    return 0
  fi

  echo "Found ${#failed_threads[@]} failed automatic thread(s); pausing dispatch of new issues."

  for thread_id in "${failed_threads[@]}"; do
    if is_retry_due "$thread_id" "$base_interval"; then
      if [[ "$DRY_RUN" == "1" ]]; then
        echo "[dry-run] would send continue to failed auto thread $thread_id"
      else
        echo "Retrying failed auto thread $thread_id with 'continue'"
        t3ctl thread send "$thread_id" --prompt "continue" || true
        record_retry "$thread_id"
      fi
    else
      echo "Retry backoff not yet elapsed for failed auto thread $thread_id"
    fi

    read -r count last < <(get_retry_state "$thread_id")
    count=${count:-0}
    last=${last:-0}
    now=$(date +%s)
    elapsed=$(( (now - last) / 60 ))
    backoff=$(( base_interval * (2 ** count) ))
    if [[ $backoff -gt 1440 ]]; then
      backoff=1440
    fi
    remaining=$(( backoff - elapsed ))
    if [[ $remaining -lt 0 ]]; then
      remaining=0
    fi
    if [[ $max_wait -eq 0 || $remaining -lt $max_wait ]]; then
      max_wait=$remaining
    fi
  done

  if [[ "${RUN_UNTIL_EMPTY:-0}" == "1" ]]; then
    if [[ $max_wait -eq 0 ]]; then
      max_wait=$base_interval
    fi
    schedule_retry_check "$max_wait"
  fi

  return 1
}

if ! handle_failed_auto_threads; then
  exit 0
fi

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
