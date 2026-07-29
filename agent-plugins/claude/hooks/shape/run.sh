#!/usr/bin/env bash
# omega:shape — PreToolUse (Write|Edit) hook
# Bounces test files written in the three always-wrong shapes for this
# ecosystem: a __tests__/ path segment, a *.spec.js filename, and a
# test/tests/ nesting. The layer CHOICE stays judgment (docs/shared/testing.md
# owns the mantra); this guards only the mechanical suite shape. Fails open on
# anything unexpected, and only polices projects that depend on @omega.js/*.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null || true)
[ -n "$file_path" ] || exit 0

# Only test-shaped writes are in scope at all.
base=$(basename "$file_path")
case "$file_path" in
  *__tests__/*|*/test/tests/*) ;;
  *)
    case "$base" in
      *.spec.js|*.spec.ts|*.spec.mjs|*.spec.cjs) ;;
      *) exit 0 ;;
    esac
    ;;
esac

# Scope guard: walk up from the file to the nearest package.json (stopping at
# the git root); only police projects that depend on (or are) @omega.js/*.
dir=$(dirname "$file_path")
manifest=""
while [ -n "$dir" ] && [ "$dir" != "/" ]; do
  if [ -f "$dir/package.json" ]; then
    manifest="$dir/package.json"
    break
  fi
  [ -e "$dir/.git" ] && break
  dir=$(dirname "$dir")
done
[ -n "$manifest" ] || exit 0
omega_linked=$(jq -r '
  [.name // ""] + ((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys)
  | map(select(startswith("@omega.js/"))) | length
' "$manifest" 2>/dev/null || echo 0)
[ "$omega_linked" -gt 0 ] 2>/dev/null || exit 0

cat >&2 <<EOF
omega:shape — test suite shape violation: $file_path
The omega ecosystem's mirrored suite shape (docs/shared/testing.md in the
Omega repo) has one home for tests: top-level test/ mirroring the source
tree, *.test.js filenames (desktop/extension FRAMEWORK suites live at
src/test/ — the recorded exception). Never __tests__/ directories, *.spec.*
names, or test/tests/ nesting. Write it as test/<mirror>/<name>.test.js.
EOF
exit 2
