# Brand agent-docs chain (AGENTS.md / CLAUDE.md)

**The problem**: every brand needs current framework guidance for AI agents, but copying it into each brand drifts. **The design (Ian 2026-07-20)**: the guidance has ONE home — `packages/manager/AGENTS.md`, shipped inside `@omega.js/manager` — and every brand root imports it.

## The chain

```
brand/CLAUDE.md            @AGENTS.md                                  (one line, Claude Code's entry)
brand/AGENTS.md   line 1:  @node_modules/@omega.js/manager/AGENTS.md  (the framework guide import)
                  line 2:  <!-- marker comment (maintained-by note for humans + non-Claude agents) -->
                  below:   the brand's own notes — NEVER touched by the framework
```

- The import path is **relative** (portable to any machine). For hoisted installs (the in-repo test brands are npm workspaces of this monorepo) the ensure step walks up and writes the correct depth, e.g. `@../../node_modules/@omega.js/manager/AGENTS.md`.
- In the local era, `node_modules/@omega.js/manager` is a `file:` symlink into this monorepo — the import resolves to the LIVE `packages/manager/AGENTS.md`, so framework edits are instantly visible to every brand session. Published installs read the shipped copy, which updates with the package.
- Non-Claude agents read `AGENTS.md` but don't follow `@` imports — the marker comment names the target file for them.

## Maintenance

`npm start` (the manage cycle's `workspace` service, `agents` op — `packages/manager/src/services/workspace/ensure/agents.js`, logic in `src/lib/agents-md.js`):

| State found | Action |
|---|---|
| No `AGENTS.md` | Created: import + marker + brand-notes skeleton |
| Import present at line 1 (right depth) | No-op |
| Import missing / not first / stale depth | Healed: resolved import moved to line 1, duplicates removed, consumer content preserved verbatim |
| No `CLAUDE.md` | Created as the one-line `@AGENTS.md` pointer |
| `CLAUDE.md` carries content | WARNED (never clobbered) with the move-it-to-AGENTS.md message |

Pinned by `packages/manager/test/agents-md.test.js` (guide shipped + files whitelist, path resolution, create/heal/idempotence, content preservation).

## Editing the guide

The guide is `packages/manager/AGENTS.md` — framework-owned, brand-agnostic (structure, verbs, per-target required-reading pointers, hard rules). Brand-specific knowledge never goes there; it belongs below the import in that brand's `AGENTS.md`.

## Per-app docs (status)

Per-app `CLAUDE.md`/`CHANGELOG.md` scaffolds predate the brand-monorepo era (each app was its own repo/workspace). Claude Code walks parent directories, so the brand-root chain covers app-dir sessions. Retiring the per-app scaffolds in brand context is queued as its own change (it touches all four frameworks' mirrored consumer templates); standalone (non-brand) apps keep them.
