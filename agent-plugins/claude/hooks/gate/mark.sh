#!/usr/bin/env bash
# omega:gate mark — the ONE sanctioned way for an agent with NO Skill tool (the
# worker class writes its files through Bash) to record that it read the guide
# a skill routes to. It writes exactly the marker the hook's PostToolUse half
# writes, through the same lib, so the two lanes cannot drift.
# The main chat never needs this: invoking the skill records itself.
# Writing a marker by hand, or running this before reading the guide, is a
# process breach — the gate is a reading contract, not a lock to pick.
#
# Usage: mark.sh <skill> [--session <id>]
#   The session id is --session when given (explicit beats ambient), else
#   $CLAUDE_SESSION_ID, else $CLAUDE_CODE_SESSION_ID. The skill takes either
#   spelling the Skill event takes (omega:web or bare web). Prints the marker
#   path it wrote.

set -euo pipefail

usage() {
  echo "usage: mark.sh <skill> [--session <id>]   (e.g. mark.sh omega:web)" >&2
  exit 1
}

skill=""
session="${CLAUDE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      [ $# -ge 2 ] || usage
      session="$2"
      shift 2
      ;;
    -*) usage ;;
    *)
      [ -z "$skill" ] || usage
      skill="$1"
      shift
      ;;
  esac
done

[ -n "$skill" ] || usage
[ -n "$session" ] || usage

# The PostToolUse half records a bare name as its namespaced form; the same
# spelling has to unlock the same surface here.
case "$skill" in
  omega:*) ;;
  *) skill="omega:$skill" ;;
esac

# shellcheck source-path=SCRIPTDIR source=../lib/omega-gate.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib/omega-gate.sh"

marker=$(omega_gate_marker "$session" "$skill")
mkdir -p "$(omega_gate_state_dir)"
: > "$marker"
echo "$marker"
