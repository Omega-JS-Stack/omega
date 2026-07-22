---
status: queued (Ian's INBOX 2026-07-21 — "tabled for after the review waves")
created: 2026-07-22
---

# claude.md/agents.md + omega:* skills reorganization

Ian's capture (2026-07-21): fix all framework CLAUDE.md/AGENTS.md files plus the global omega skills so they match the monorepo reality — the frameworks are no longer called UJM/BEM/BXM/EM and no longer live in separate repos.

## Scope
- Global skills to adapt (keep the same principles unless the framework itself changed; update naming + monorepo layout):
  - `~/.dotfiles/dotfiles/.claude/skills/omega:bem`, `omega:bxm`, `omega:em`, `omega:main`, `omega:mam`, `omega:ujm`, `omega:wm`
- Framework CLAUDE.md/AGENTS.md files in this monorepo: verify current state, update where stale — starting with the main entry point consumers import (`/Users/ian/Developer/Repositories/Omega/omega/AGENTS.md` and the `packages/manager/AGENTS.md` chain per docs/agent-docs.md).

## Sequencing
After the review waves finish (Ian's explicit tabling). Larger task; plan the pass before editing.
