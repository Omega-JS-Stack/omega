#!/usr/bin/env bash
# omega:quality — PostToolUse (Write|Edit) + Stop hook
# Fires the quality skills deterministically instead of by model judgment: a
# write to a web surface asks for the skills that own it (omega:seo,
# omega:accessibility, omega:brandcheck), and the Stop pass refuses a sign-off
# that never went through their checklists. One script for both events so the
# surface table has ONE home; the event comes off hook_event_name.
# Fails open on anything unexpected, and only polices projects that depend on
# (or are) @omega.js/*.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

event=$(jq -r '.hook_event_name // ""' <<<"$input" 2>/dev/null || true)
session_id=$(jq -r '.session_id // ""' <<<"$input" 2>/dev/null || true)

state_dir="${TMPDIR:-/tmp}/omega-quality"
safe_session="${session_id//[^a-zA-Z0-9]/_}"
pending="$state_dir/${safe_session}.pending"

# --- Stop: the re-check -------------------------------------------------------
# Blocks once on the web surfaces edited since the last block, then clears the
# list so a re-armed session needs a fresh edit. stop_hook_active means the
# block already ran on this turn.
if [ "$event" = "Stop" ]; then
  stop_hook_active=$(jq -r '.stop_hook_active // false' <<<"$input" 2>/dev/null || true)
  if [ "$stop_hook_active" = "true" ]; then
    exit 0
  fi
  [ -s "$pending" ] || exit 0

  # TAB-delimited on both sides: a path may contain spaces.
  files=$(cut -d"$(printf '\t')" -f1 <"$pending" | sort -u)
  skills=$(cut -d"$(printf '\t')" -f2 <"$pending" | tr ',' '\n' | sed '/^$/d' | sort -u | tr '\n' ',' | sed 's/,$//; s/,/, /g')
  count=$(printf '%s\n' "$files" | grep -c . || true)
  rm -f "$pending" 2>/dev/null || true

  ctx="omega:quality — $count web surface(s) were edited this session:
$files

Before signing off, walk each edited surface against the checklists in: ${skills}. Invoke the skill via the Skill tool if it is not loaded, report what you checked, and fix what fails. If a checklist item does not apply to the change, say so — do not skip the pass silently."

  jq -n --arg ctx "$ctx" '{
    "decision": "block",
    "reason": "omega:quality — edited web surfaces have not been reviewed against the quality checklists.",
    "hookSpecificOutput": {
      "hookEventName": "Stop",
      "additionalContext": $ctx
    }
  }'
  exit 0
fi

# --- PostToolUse: the surface match ------------------------------------------
file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null || true)
[ -n "$file_path" ] || exit 0

# The surface table: a path pattern → the skills that own that surface. Rows
# accumulate, so head.html matches both its include row and its seo row.
matched=()
while read -r pattern skills; do
  [ -n "$pattern" ] || continue
  # The unquoted pattern is the point — case globs it.
  # shellcheck disable=SC2254
  case "$file_path" in
    $pattern) matched+=("$skills") ;;
  esac
done <<'MAP'
*/pages/*.html omega:seo,omega:accessibility
*/pages/*.md omega:seo,omega:accessibility
*/_layouts/* omega:seo,omega:accessibility
*.liquid omega:seo,omega:accessibility
*/_includes/core/head.html omega:seo
*/_includes/core/foot.html omega:seo
*/_includes/*.html omega:accessibility
*/sections/*.html omega:accessibility
*/components/*.html omega:accessibility
*/assets/js/*.js omega:accessibility
*/core/js/*.js omega:accessibility
*.scss omega:accessibility,omega:brandcheck
*.css omega:accessibility,omega:brandcheck
*/omega.json5 omega:brandcheck
*/_includes/*.json omega:brandcheck
*/sections/*.json5 omega:brandcheck
MAP

[ "${#matched[@]}" -gt 0 ] || exit 0

# Scope guard: only police projects that depend on (or are) @omega.js/*.
scope_lib="$(dirname "${BASH_SOURCE[0]}")/../lib/omega-scope.sh"
[ -r "$scope_lib" ] || exit 0
# shellcheck source-path=SCRIPTDIR source=../lib/omega-scope.sh
. "$scope_lib"
omega_scope "$file_path" || exit 0

owners=$(printf '%s\n' "${matched[@]}" | tr ',' '\n' | sort -u | paste -sd, -)

# Arm the Stop re-check with this surface.
mkdir -p "$state_dir" 2>/dev/null || true
printf '%s\t%s\n' "$file_path" "$owners" >>"$pending" 2>/dev/null || true

# The reminder itself is once per session per skill — the same rule the inject
# hook follows. The Stop pass is what carries the per-file accounting.
fresh=()
for skill in $(printf '%s' "$owners" | tr ',' '\n'); do
  marker="$state_dir/${safe_session}__${skill//[:\/]/_}.asked"
  [ -f "$marker" ] && continue
  : > "$marker" 2>/dev/null || true
  fresh+=("$skill")
done
[ "${#fresh[@]}" -gt 0 ] || exit 0

skill_list=$(printf ', %s' "${fresh[@]}")
skill_list="${skill_list:2}"

jq -n --arg ctx "omega:quality — web surface edited ($file_path): invoke ${skill_list} via the Skill tool and hold this work to the checklists you find there. (Named once per session per skill; the Stop pass re-checks every edited surface before sign-off.)" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $ctx
  }
}'
exit 0
