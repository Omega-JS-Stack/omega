---
name: main
description: OMEGA ecosystem hub — the framework roster, the documentation topology every framework shares, the mirror spec that keeps their docs and skills structurally identical, brand/project directory resolution, and global operations across repos. - Use when working across more than one OMEGA framework, when restructuring any framework doc or skill, or when building a full stack app on UJM + BEM + BXM + EM together. Triggers on "OMEGA", "all frameworks", "every framework", "all four frameworks", "mirrored change", "mirror spec", "documentation topology", "framework docs structure", "CLAUDE.md in all frameworks", "full stack app", "new OMEGA project", or any change that has to land the same way in every framework repo. ALSO USE when the user mentions ANY project/brand by name for ANY task — auditing, fixing, checking, debugging, reviewing, deploying, or touching files in a specific brand's repo. Triggers on "audit X", "fix X", "check X", "debug X", "review X", "look at X", "work on X", "X backend", "X website", "X extension", "X mobile app", or any brand name (proxifly, somiibo, studymonkey, chartr, notevault, clipboard-history, etc.) that requires navigating to a project directory. ALSO use for bulk changes across repos — triggers on "global operation", "all projects", "all brands", "bulk update", "mass update", "every repo", "all repos", "across all".
user-invocable: true
---

# OMEGA Main

Hub skill for the OMEGA ecosystem — the concerns that cut across ALL OMEGA frameworks (UJM, BEM, BXM, MAM, EM). Framework-specific facts live in each framework's repo docs, routed by [omega:ujm](../ujm/SKILL.md), [omega:bem](../bem/SKILL.md), [omega:bxm](../bxm/SKILL.md), [omega:em](../em/SKILL.md), [omega:mam](../mam/SKILL.md) — this hub covers only the cross-cutting concerns. The shared **web-manager** library (the frontend singleton embedded by UJM/BXM/EM) has its own router, [omega:wm](../wm/SKILL.md).

## OMEGA Framework Overview

| Prefix | Name | Purpose | Typical repo suffix |
|--------|------|---------|---------------------|
| UJM / UJ | Ultimate Jekyll Manager | Frontend static sites | `{brand}` or `{brand}-website` |
| BEM / BM | Backend Manager | Firebase functions / backend | `{brand}-backend` |
| BXM | Browser Extension Manager | Chrome/Firefox extensions | `{brand}-extension` |
| MAM | Mobile App Manager | iOS/Android apps | `{brand}-mobile` |
| EM | (Desktop) Electron Manager | Desktop apps | `{brand}-desktop` |

All OMEGA projects live under `/Users/ian/Developer/Repositories/ITW-Creative-Works/`. The canonical list of brands and their resolved repo paths is owned by `omega-manager`.

## Documentation topology (where things live)

Every framework has the SAME four documentation surfaces — know which one you're touching:

| Surface | Where | What it is / who it's for |
|---------|-------|---------------------------|
| **Root `CLAUDE.md`** | `<framework repo>/CLAUDE.md` | Framework developer overview — for working ON the framework itself. A table of contents; the meat lives in `docs/`. |
| **Deep docs** | `<framework repo>/docs/<topic>.md` | Subsystem deep references, indexed by the root CLAUDE.md's `## Documentation` section. Shared concepts use the SAME filename in every repo (e.g. `cdp-debugging.md`, `test-framework.md`). |
| **Consumer template** | `<framework repo>/src/defaults/CLAUDE.md` | Gets scaffolded INTO consumer projects as their CLAUDE.md — the `Default Values` half is framework-owned; the `Custom Values` half below it belongs to the project. For working IN a consumer. |
| **Skill router** | this plugin's `skills/<fw>/SKILL.md` (surfaced as `omega:<fw>`) | The per-framework Claude router — hard rules + pointers into the repo docs. Auto-injected when a project's package.json matches the framework. |

All four surfaces are structurally **MIRRORED** across the frameworks — same sections, same order ([resources/mirror-spec.md](resources/mirror-spec.md)). A doc change usually lands in ONE surface of ONE repo; a STRUCTURAL change lands in that surface of EVERY repo.

## Hard rules

1. 🚫 **Never guess a repo path.** When the user says "audit proxifly" or "fix the somiibo backend", do NOT assume the repo path — naming varies by framework type and project history. Resolve it via [resources/find-repo.md](resources/find-repo.md) before running any file operations.
2. 🚫 **Never commit or push** without explicit user request.
3. **Only work in `src/`** in consumer repos — never `dist/`, `node_modules/`, or build output; always verify with `git diff`.
4. **Never search or operate in** `_legacy`, `_backup`, `_site`, `dist`, `node_modules` — exclude them from all Glob, Grep, and file operations.
5. **Preserve existing functionality** — don't destroy custom/unique data in consumer repos.
6. 🚫 **Never fan out agents unprompted** — multi-agent dispatch (bulk operations across repos, full-stack builds) runs ONLY when the user explicitly asks for it.
7. **Docs and skills are MIRRORED across the frameworks — keep them that way.** Root `CLAUDE.md`, `src/defaults/CLAUDE.md`, shared-concept `docs/*.md` filenames, and this plugin's framework skills follow identical section skeletons in identical order. Structural changes (add/rename/reorder a section, new shared doc) must be made in EVERY sister repo/skill in the same pass. The canonical skeletons + omission rules: [resources/mirror-spec.md](resources/mirror-spec.md).

## Processes

### Resolve a brand name to a repo
- **READ THIS FIRST** when the user references a project by brand name: [resources/find-repo.md](resources/find-repo.md).

### Global operation across repos
- Bulk/mirrored changes across framework repos or consumer brand repos — scope inference, repo-list resolution, prototype-first agent fan-out, summary report: [resources/global-operation.md](resources/global-operation.md).

### Mirrored docs & skills structure
- The canonical section skeletons for root `CLAUDE.md`, consumer `src/defaults/CLAUDE.md`, shared-concept docs, and this plugin's framework skills — and the rules for keeping every framework structurally identical: [resources/mirror-spec.md](resources/mirror-spec.md). Consult it BEFORE restructuring any framework doc or skill.

### Full-stack builds — the session IS the orchestrator
Omega is a monorepo; the open session coordinates directly. For multi-surface missions, dispatch subagents with the relevant framework docs named in each brief, one surface per brief.
