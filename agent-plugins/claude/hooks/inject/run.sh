#!/usr/bin/env bash
# omega:inject — UserPromptSubmit hook
# Reads the project's package.json and asks the session to invoke the matching
# framework skill. Once per session; fails open on anything unexpected.

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

# BEM consumers keep backend-manager in functions/package.json with a plain
# site manifest at the root, so the functions manifest joins the dep pool.
fn_manifest="$(dirname "$manifest")/functions/package.json"

own_name=$(jq -r '.name // empty' "$manifest" 2>/dev/null || true)
deps=$(jq -r '((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys) | .[]' "$manifest" 2>/dev/null || true)
if [ -f "$fn_manifest" ]; then
  fn_deps=$(jq -r '((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys) | .[]' "$fn_manifest" 2>/dev/null || true)
  deps=$(printf '%s\n%s' "$deps" "$fn_deps")
fi

# package → skill. web-manager is the exception: it matches on the project's own
# name only, because half the frameworks depend on the library without the
# session working IN it.
matched=()
while read -r pkg skill signal; do
  [ -n "$pkg" ] || continue
  if [ "$own_name" = "$pkg" ]; then
    matched+=("$skill")
  elif [ "$signal" != "name" ] && grep -qxF "$pkg" <<<"$deps"; then
    matched+=("$skill")
  fi
done <<'MAP'
ultimate-jekyll-manager omega:ujm any
backend-manager omega:bem any
browser-extension-manager omega:bxm any
electron-manager omega:em any
mobile-app-manager omega:mam any
web-manager omega:wm name
MAP

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

jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
