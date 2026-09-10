#!/usr/bin/env bash
# omega gate markers — sourced by the two writers of a gate marker: the gate
# hook itself (PostToolUse Skill) and mark.sh (the one command an agent with no
# Skill tool runs after reading the guide). ONE home for where a marker lives
# and what it is called, so the two lanes can never disagree about the name.

# omega_gate_state_dir
# The marker directory. Under TMPDIR so it dies with the machine's temp state;
# never created here — each caller decides what an unusable directory means.
omega_gate_state_dir() {
  printf '%s/omega-gate\n' "${TMPDIR:-/tmp}"
}

# omega_gate_marker <session_id> <skill>
# The marker path for one skill in one session. Both halves are flattened to
# safe filename characters, so a session id or a skill spelling can never walk
# out of the state directory.
omega_gate_marker() {
  printf '%s/%s__%s.invoked\n' "$(omega_gate_state_dir)" "${1//[^a-zA-Z0-9]/_}" "${2//[:\/]/_}"
}
