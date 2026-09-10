#!/usr/bin/env bash
# omega:gate — PreToolUse (Write|Edit) + PostToolUse (Skill) hook
# The enforcement half of the inject hook: injecting a line only SUGGESTS the
# skill, and a session that skipped the line built a whole website target
# without ever reading the docs. So the surfaces a skill owns are refused until
# that skill was actually invoked — a target's tree, a brand's config/omega.json5,
# and a monorepo package that has a skill. Read-only tools are never in scope
# (the matcher is Write|Edit), and every other path stays free.
# One script for both events so the surface question has ONE answer; the event
# comes off hook_event_name. Fails open on anything unexpected.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

event=$(jq -r '.hook_event_name // ""' <<<"$input" 2>/dev/null || true)
session_id=$(jq -r '.session_id // ""' <<<"$input" 2>/dev/null || true)

# The marker naming is shared with mark.sh, the sanctioned command for an agent
# with no Skill tool: one lib, so the two writers cannot drift apart.
gate_lib="$(dirname "${BASH_SOURCE[0]}")/../lib/omega-gate.sh"
[ -r "$gate_lib" ] || exit 0
# shellcheck source-path=SCRIPTDIR source=../lib/omega-gate.sh
. "$gate_lib"

state_dir=$(omega_gate_state_dir)

marker_for() {
  omega_gate_marker "$session_id" "$1"
}

# --- PostToolUse (Skill): the record --------------------------------------
# The Skill tool's input names the skill it ran; the spelling is the tool's
# business, so both the namespaced form (omega:web) and the bare skill name
# (web, which the plugin namespaces) count as the same invocation.
if [ "$event" = "PostToolUse" ]; then
  mkdir -p "$state_dir" 2>/dev/null || true
  values=$(jq -r '[.tool_input // {} | .. | strings] | .[]' <<<"$input" 2>/dev/null || true)

  # The brace group is what makes the failure silent: redirections apply left to
  # right, so a bare `: > file 2>/dev/null` still prints its own failure.
  while read -r skill; do
    [ -n "$skill" ] || continue
    { : > "$(marker_for "$skill")"; } 2>/dev/null || true
  done < <(grep -oE 'omega:[a-z][a-z-]*' <<<"$values" 2>/dev/null || true)

  while read -r name; do
    [ -n "$name" ] || continue
    { : > "$(marker_for "omega:$name")"; } 2>/dev/null || true
  done < <(grep -xE '[a-z][a-z-]*' <<<"$values" 2>/dev/null || true)

  exit 0
fi

# --- PreToolUse (Write|Edit): the refusal ---------------------------------
file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null || true)
[ -n "$file_path" ] || exit 0

skills_lib="$(dirname "${BASH_SOURCE[0]}")/../lib/omega-skills.sh"
[ -r "$skills_lib" ] || exit 0
# shellcheck source-path=SCRIPTDIR source=../lib/omega-skills.sh
. "$skills_lib"

# A surface can answer with MORE than one skill — a theme surface owns its
# framework's skill and omega:theme both — so the answer is read line by line
# and every skill has to have been invoked before the write goes through.
skills=$(omega_skill_for_file "$file_path")
[ -n "$skills" ] || exit 0

# No usable state dir means the record half could never have written a marker,
# so every write would refuse forever. Fail open instead of deadlocking.
mkdir -p "$state_dir" 2>/dev/null || true
{ [ -d "$state_dir" ] && [ -w "$state_dir" ]; } || exit 0

missing=()
while read -r skill; do
  [ -n "$skill" ] || continue
  [ -f "$(marker_for "$skill")" ] && continue
  missing+=("$skill")
done <<<"$skills"

[ "${#missing[@]}" -gt 0 ] || exit 0

skill=$(printf ', %s' "${missing[@]}")
skill="${skill:2}"

cat >&2 <<EOF
omega:gate — $skill has not been loaded, and owns this surface: $file_path
Invoke $skill via the Skill tool, read the framework map it routes to
(the brand's AGENTS.md import line, node_modules/@omega.js/AGENTS.md), and
then make this edit. The framework has conventions for this surface — pages,
sections, config keys, routes — and hand-rolling it is the failure this gate
exists to stop. Reading tools are free; this refusal only covers writes.
EOF
exit 2
