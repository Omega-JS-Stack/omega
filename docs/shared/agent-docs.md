# Brand agent-docs chain (AGENTS.md / CLAUDE.md)

**The problem**: every brand needs current framework guidance for AI agents, but copying it into each brand drifts. **The design (Ian 2026-07-20, amended 2026-07-27)**: every brand reads the SAME entry the monorepo uses — the top-level omega `AGENTS.md`, the map — and the map's pointers (plus the omega plugin's hooks) orchestrate which docs load. The brand-root knowledge itself lives in `docs/manager/brand.md`; no AGENTS.md anywhere carries content.

## The chain

```
brand/CLAUDE.md            @AGENTS.md                          (one line, Claude Code's entry)
brand/AGENTS.md   line 1:  @node_modules/@omega.js/AGENTS.md  (the top-level omega map — see below)
                  below:   `# <brand> — brand notes` + the brand's own notes — NEVER touched by the framework
```

`node_modules/@omega.js/AGENTS.md` is a SYMLINK the workspace service maintains: it resolves the framework monorepo through the installed manager package's real path and links straight at the live top-level map. It sits in the scope directory — no package in the path — because the map belongs to the ecosystem, not to any one package. Published installs get the map vendored into the package and the link retargeted (gated on the docs-vendoring issue, [#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

(The cp244 marker comment under the import was culled — Ian 2026-07-20: keep it short; heals scrub any legacy copy.)

- The import path is **relative** (portable to any machine). For hoisted installs (the in-repo test brands are npm workspaces of this monorepo) the ensure step walks up and writes the correct depth, e.g. `@../../node_modules/@omega.js/AGENTS.md`.
- The service resolves the monorepo through the installed manager package's real path (the local-era `file:` symlink), so the link always lands on the LIVE top-level map — framework edits are instantly visible to every brand session.
- Non-Claude agents read `AGENTS.md` but don't follow `@` imports — the import line itself names the target path for them.

## Maintenance

`npm start` (the manage cycle's `workspace` service, `agents` op — `packages/manager/src/services/workspace/ensure/agents.js`, logic in `src/lib/agents-md.js`):

| State found | Action |
|---|---|
| No `AGENTS.md` | Created: import + marker + brand-notes skeleton |
| Import present at line 1 (right depth) | No-op |
| Import missing / not first / stale depth | Healed: resolved import moved to line 1, duplicates removed, consumer content preserved verbatim |
| No `CLAUDE.md` | Created as the one-line `@AGENTS.md` pointer |
| `CLAUDE.md` carries content | WARNED (never clobbered) with the move-it-to-AGENTS.md message |

Pinned by `packages/manager/test/agents-md.test.js` (no package agent docs + files whitelist, guide-link create/heal/skip, path resolution, create/heal/idempotence, content preservation).

## Packages carry no agent docs (Ian 2026-07-27)

No `packages/<pkg>/` has an `AGENTS.md` or `CLAUDE.md` — deleted outright, no exceptions. Monorepo sessions get the map from the parent walk; consumer brands get it through the maintained scope symlink; a standalone package install has no resolvable chain anyway; the publish era generates whatever a shipped package needs ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

## The one deliberate gap
- **`apps/sandbox-brand` carries NO agent-docs chain.** It is a synthetic fixture the automated corpus/e2e runs mangle and reset — nothing durable lives there, so nothing agent-facing is written there.

## Editing the guide

The brand-root guide is [docs/manager/brand.md](../manager/brand.md) — framework-owned, brand-agnostic (structure, verbs, per-target required-reading pointers, hard rules). Brand-specific knowledge belongs below the import in that brand's own `AGENTS.md`.

## Per-app docs — RETIRED in brand context (cp246)

Per-app `CLAUDE.md`/`CHANGELOG.md`/`docs/` scaffolds predate the brand-monorepo era; Claude Code walks parent directories, so the brand-root chain covers app-dir sessions. The shared defaults engine now has a `retire` fileMap rule (devkit `defaults-engine.js`), wired mirrored in all four frameworks' brand branches (detection = the existing `@omega.js/config` brand-root resolution): in a brand app those files NEVER scaffold; an existing framework-owned-only copy (Custom section empty/whitespace or byte-equal to the shipped boilerplate; marker-less files must equal the rendered template) is deleted once, loudly; a copy carrying real consumer content is preserved with a move-it-to-the-brand-root warning. Standalone apps keep full per-app doc scaffolding (test-pinned both ways).
