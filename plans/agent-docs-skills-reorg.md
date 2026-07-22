---
status: queued (Ian 2026-07-21 tabled; scope widened by Ian 2026-07-22)
created: 2026-07-22
---

# Documentation + skills revamp: omega:* skills rewrite + monorepo AGENTS.md complete rewrite

Ian's capture (2026-07-21): fix all framework CLAUDE.md/AGENTS.md files plus the global omega skills
so they match the monorepo reality. Widened (2026-07-22): "all of our old skills are legacy now and
refer to the old system" and "the new agents.md needs to be COMPLETELY rewritten to be kickass and
cover everything in an efficient way so that new agents can open up a monorepo and get started
immediately."

## Scope

### 1. Global omega:* skills — full rewrite, not adaptation
All seven refer to the OLD system (separate repos, UJM/BEM/BXM/EM names, old command surfaces):
- `~/.dotfiles/dotfiles/.claude/skills/omega:main` — the router/entry skill; rewrite around the
  monorepo (`@omega.js/*` names, brand topology, `omega` dispatcher bins, local era)
- `omega:bem` → backend, `omega:ujm` → web, `omega:bxm` → extension, `omega:em` → desktop,
  `omega:wm` → client, `omega:mam` — parked framework; skill shrinks to a "parked, slot reserved" stub
- Skills stay router-shaped per the layering model: triggers + pointers into the repos' own docs,
  never a second home for facts. Rename question (omega:bem → omega:backend etc.) decided in the pass.

### 2. Monorepo entry point — complete AGENTS.md rewrite
- Ian's diagnosis (2026-07-22, refined): the current file "is just not good — not targeted, a bunch
  of legacy notes; read it and then look at our actual work and it's not a good instruction." The
  rewrite is not about a single audience: it is THE entry point, and its job is to describe each
  framework (web, desktop, backend, extension, client, manager, devkit, …) and LINK to their specific
  docs — a real map, not accumulated history. Rewrite from scratch; ≤250-line budget stands.
- Docs reorganization to design in the same pass (Ian's direction, exploratory): split docs the way
  the frameworks split — shared/cross-framework concepts in ONE shared home, framework-unique detail
  in that framework's own docs, entry point linking both. Interacts with the existing mirror-spec
  (mirrored per-package CLAUDE.md skeletons) — decide whether mirroring survives or the shared layer
  replaces the mirrored copies (SSOT favors the latter).
- KEEP the migration story: a short "migrated from backend-manager/UJM/BXM/EM/WM" section so the
  lineage is discoverable.
- PRESERVE the old-system CLAUDE.md/AGENTS.md files: archive copies (e.g. `_attic/legacy-agent-docs/`
  or pointers to the read-only legacy repos, decided in the pass) rather than losing them.

### 3. Per-package + brand chain
- `packages/*/CLAUDE.md` + `packages/manager/AGENTS.md` chain (docs/agent-docs.md contract): verify
  against shipped reality, fix staleness, keep the mirror-spec structure across sister frameworks.

## Sequencing
After the review waves finish (Ian's explicit tabling). Large pass; plan the structure before editing —
waves 2–6 will churn behavior, so rewriting docs first would go stale immediately.
