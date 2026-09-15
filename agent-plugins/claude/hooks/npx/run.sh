#!/usr/bin/env bash
# omega:npx: PreToolUse (Bash) hook
# `npx omega` with no local bin is a REGISTRY FETCH ([#881](https://github.com/Omega-JS-Stack/omega/issues/881)):
# npx downloads the public package named `omega` (a stranger's project) and runs
# it with the shell's environment. A human gets npx's "Need to install, ok to
# proceed?" prompt; an agent's Bash tool has no terminal, so it auto-installs,
# which is how a runner spent 30 minutes running a stranger's CLI with the
# workflow secrets in env ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
# So: a command that runs `omega`/`omg`/`mgr` through `npx` or `npm exec` is
# refused unless `node_modules/.bin/omega` resolves walking up from the working
# directory to the git root. The monorepo is NOT exempt: an installed tree
# passes there like anywhere else. Fails open on anything unexpected.

set -euo pipefail
# The tokenizer below re-splits a command string, and a glob in it must stay
# the literal word it was written as.
set -f

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

command_line=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null || true)
[ -n "$command_line" ] || exit 0

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

# Does this segment RUN one of the three bins through the registry fetcher?
# `npx [flags] <bin>` and `npm exec [flags] [--] <bin>`, leading VAR=value
# assignments skipped. Word splitting is exactly the tokenization wanted here.
invokes_omega() {
  # shellcheck disable=SC2086
  set -- $1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      *=*) shift ;;
      *) break ;;
    esac
  done
  case "${1:-}" in
    npx) shift ;;
    npm)
      shift
      [ "${1:-}" = "exec" ] || return 1
      shift
      ;;
    *) return 1 ;;
  esac
  # Flags (and a bare `--`) sit between the runner and the bin name.
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -*) shift ;;
      *) break ;;
    esac
  done
  # A version spec rides the bin name (`npx omega@latest`), and that form is the
  # most direct registry fetch of the lot.
  case "${1:-}" in
    omega|omega@*|omg|omg@*|mgr|mgr@*) return 0 ;;
  esac
  return 1
}

# One segment per program run: the shell's separators, turned into newlines.
# `cd <dir> &&` prefixes are read on the way past, so the walk starts where the
# command actually lands.
separator=$'\001'
segments="$command_line"
segments="${segments//&&/$separator}"
segments="${segments//||/$separator}"
segments="${segments//;/$separator}"
segments="${segments//|/$separator}"
segments="${segments//&/$separator}"
segments="${segments//$'\n'/$separator}"

landing=""
invoked=0
while IFS= read -r segment; do
  segment=$(trim "$segment")
  [ -n "$segment" ] || continue
  case "$segment" in
    cd|cd\ *|cd$'\t'*)
      target=$(trim "${segment#cd}")
      target="${target%\"}"; target="${target#\"}"
      target="${target%\'}"; target="${target#\'}"
      # Only an absolute hop is resolvable from here. A relative one (or a bare
      # `cd` home) is a directory this hook cannot name: fail open.
      case "$target" in
        /*) landing="$target" ;;
        *) exit 0 ;;
      esac
      ;;
    *)
      if invokes_omega "$segment"; then
        invoked=1
        break
      fi
      ;;
  esac
done <<<"${segments//$separator/$'\n'}"

[ "$invoked" = "1" ] || exit 0

# The working directory: where the command lands, else the one the event
# carries, else this hook's own.
dir="$landing"
[ -n "$dir" ] || dir=$(jq -r '.tool_input.cwd // .cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$dir" ] || dir="${PWD:-}"
[ -n "$dir" ] || exit 0
# `dirname` bottoms out at "." for a relative path and stays there forever, so
# an unanchored walk never terminates. Nothing to resolve, fail open.
case "$dir" in /*) ;; *) exit 0 ;; esac
[ -d "$dir" ] || exit 0

probe="$dir"
while : ; do
  [ -e "$probe/node_modules/.bin/omega" ] && exit 0
  # The git root is the top of this project's install; above it is somebody
  # else's node_modules, which npx would never resolve for this command anyway.
  [ -e "$probe/.git" ] && break
  [ "$probe" = "/" ] && break
  next=$(dirname "$probe")
  [ "$next" = "$probe" ] && break
  probe="$next"
done

cat >&2 <<EOF
omega:npx: no framework installed here, so this would be a registry fetch.
Looked for node_modules/.bin/omega from $dir up to the git root.
Fix: run the install first, or run the package's own bin by path.
The local-install contract: docs/shared/local-dev.md.
EOF
exit 2
