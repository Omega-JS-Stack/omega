#!/usr/bin/env bash
# omega:inject — UserPromptSubmit hook
# Reads the project's package.json and asks the session to invoke the matching
# framework skill. At a BRAND root the nearest manifest carries the manager
# alone, so the brand's targets are discovered too (config/omega.json5 and
# every targets/*/package.json) and the whole set is asked for at once, with
# the framework map named as required reading.
# Once per session per skill; fails open on anything unexpected.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

session_id=$(jq -r '.session_id // ""' <<<"$input" 2>/dev/null || true)
cwd=$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] && [ -d "$cwd" ] || exit 0

# The project's package.json: the cwd's own, else the nearest one above it —
# stopping at the git root, since past it is somebody else's project.
manifest=""
dir="$cwd"
while [ -n "$dir" ] && [ "$dir" != "/" ]; do
  if [ -f "$dir/package.json" ]; then
    manifest="$dir/package.json"
    break
  fi
  [ -e "$dir/.git" ] && break
  dir=$(dirname "$dir")
done
[ -n "$manifest" ] || exit 0

# Backend apps keep @omega.js/backend in functions/package.json with a plain
# app manifest at the root, so the functions manifest joins the dep pool.
fn_manifest="$(dirname "$manifest")/functions/package.json"

own_name=$(jq -r '.name // empty' "$manifest" 2>/dev/null || true)
deps=$(jq -r '((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys) | .[]' "$manifest" 2>/dev/null || true)
if [ -f "$fn_manifest" ]; then
  fn_deps=$(jq -r '((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys) | .[]' "$fn_manifest" 2>/dev/null || true)
  deps=$(printf '%s\n%s' "$deps" "$fn_deps")
fi

# package → skill lives in the shared table (hooks/lib/omega-skills.sh), the one
# the gate hook reads too. These rows only say HOW a package matches: every row
# matches the manifest's OWN name, which is what covers working inside
# `packages/<pkg>` in the monorepo, and `name` rows match ONLY that way —
# web, desktop, and extension all depend on the client runtime, so a dependency
# on it says nothing about what the session works on.
skills_lib="$(dirname "${BASH_SOURCE[0]}")/../lib/omega-skills.sh"
[ -r "$skills_lib" ] || exit 0
# shellcheck source-path=SCRIPTDIR source=../lib/omega-skills.sh
. "$skills_lib"

matched=()
while read -r pkg signal; do
  [ -n "$pkg" ] || continue
  skill=$(omega_skill_for "$pkg")
  [ -n "$skill" ] || continue
  if [ "$own_name" = "$pkg" ]; then
    matched+=("$skill")
  elif [ "$signal" != "name" ] && grep -qxF "$pkg" <<<"$deps"; then
    matched+=("$skill")
  fi
done <<'MAP'
@omega.js/web any
@omega.js/backend any
@omega.js/desktop any
@omega.js/extension any
@omega.js/manager any
@omega.js/client name
omega name
MAP

# Brand-level discovery. A brand root's manifest carries @omega.js/manager and
# nothing else, so the frameworks a brand actually runs live one level down, in
# config/omega.json5 and each targets/*/package.json. Read them all: a session
# at a brand root has to know about every target before it edits one.
brand_root=$(omega_brand_root "$cwd")
if [ -n "$brand_root" ]; then
  while read -r skill; do
    [ -n "$skill" ] || continue
    matched+=("$skill")
  done < <(omega_brand_skills "$brand_root")
fi

[ "${#matched[@]}" -gt 0 ] || exit 0

# One injection per session per skill.
marker_dir="${TMPDIR:-/tmp}/omega-inject"
mkdir -p "$marker_dir" 2>/dev/null || true
safe_session="${session_id//[^a-zA-Z0-9]/_}"

fresh=()
for skill in $(printf '%s\n' "${matched[@]}" | sort -u); do
  marker="$marker_dir/${safe_session}__${skill//[:\/]/_}.loaded"
  [ -f "$marker" ] && continue
  : > "$marker" 2>/dev/null || true
  fresh+=("$skill")
done

[ "${#fresh[@]}" -gt 0 ] || exit 0

if [ "${#fresh[@]}" -eq 1 ]; then
  ctx="OMEGA project detected: invoke the ${fresh[0]} skill via the Skill tool before responding. Follow its rules and the framework docs it routes to for any work in this project. (Injected once per session; do not re-invoke on later prompts unless the work shifts.)"
else
  skill_list=$(printf ', %s' "${fresh[@]}")
  skill_list="${skill_list:2}"
  ctx="OMEGA project detected: invoke these skills via the Skill tool before responding: ${skill_list}. Follow their rules and the framework docs they route to for any work in this project. (Injected once per session; do not re-invoke on later prompts unless the work shifts.)"
fi

# In a brand, the skills and the framework map are REQUIRED reading before the
# first edit, not a suggestion — the gate hook refuses a target edit until the
# skill that owns it was invoked.
if [ -n "$brand_root" ]; then
  ctx="$ctx
This is an OMEGA brand monorepo: every skill above, plus the framework map it points at (the brand AGENTS.md import line — node_modules/@omega.js/AGENTS.md), is required reading BEFORE the first edit. Writes under targets/ and to config/omega.json5 are refused until the skill owning that surface has been invoked."
fi

jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
