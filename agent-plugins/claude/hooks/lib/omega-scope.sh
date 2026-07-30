#!/usr/bin/env bash
# omega scope guard — sourced by the hooks that police a FILE path (shape,
# quality). One home for the question "is this file inside an omega project?",
# so the two guards can never disagree about what they police.
# The inject hook asks a different question (a project from a cwd, with its
# functions/ manifest joined in) and keeps its own walk.

# omega_scope <file_path>
# Walks up from the file to the nearest package.json, stopping at the git root
# (past it is somebody else's project), and succeeds only when that manifest IS
# or DEPENDS ON an @omega.js/* package. Returns 1 on no manifest, no jq, or
# unparseable JSON — the fail-open answer for a hook.
omega_scope() {
  local file_path="$1"
  [ -n "$file_path" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1

  local dir manifest omega_linked
  dir=$(dirname "$file_path")
  manifest=""
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ]; then
      manifest="$dir/package.json"
      break
    fi
    if [ -e "$dir/.git" ]; then
      break
    fi
    dir=$(dirname "$dir")
  done
  [ -n "$manifest" ] || return 1

  omega_linked=$(jq -r '
    [.name // ""] + ((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys)
    | map(select(startswith("@omega.js/"))) | length
  ' "$manifest" 2>/dev/null || echo 0)
  case "$omega_linked" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$omega_linked" -gt 0 ] || return 1
}
