# Brand agent-docs chain (AGENTS.md / CLAUDE.md)

**The problem**: every brand needs current framework guidance for AI agents, but copying it into each brand drifts. **The design (Ian 2026-07-20, amended 2026-07-27)**: every brand reads the SAME entry the monorepo uses — the top-level omega `AGENTS.md`, the map — and the map's pointers (plus the omega plugin's hooks) orchestrate which docs load. The brand-root knowledge itself lives in `docs/manager/brand.md`; no AGENTS.md anywhere carries content.

## The chain

```
brand/CLAUDE.md            @AGENTS.md                          (one line, Claude Code's entry)
brand/AGENTS.md   line 1:  @node_modules/@omega.js/AGENTS.md  (the top-level omega map — see below)
                  below:   `# <brand> — brand notes` + the brand's own notes — NEVER touched by the framework
```

`node_modules/@omega.js/AGENTS.md` is a SYMLINK the workspace service maintains: it resolves the framework monorepo through the installed manager package's real path and links straight at the live top-level map. It sits in the scope directory — no package in the path — because the map belongs to the ecosystem, not to any one package. A published install has no monorepo above the package, so the link lands on the map prepare vendored INTO it (`@omega.js/manager/docs/AGENTS.md`, below). The two candidates are tried in that order, live map first, so a locally linked brand never lands on the generated copy sitting in that same monorepo's `packages/manager` ([#144](https://github.com/Omega-JS-Stack/omega/issues/144)).

(The cp244 marker comment under the import was culled — Ian 2026-07-20: keep it short. Heals no longer scrub legacy copies (#148): a leftover marker or retired import line is consumer content, removed by hand per [breaking-changes.md](breaking-changes.md).)

- The import path is **relative** (portable to any machine). For hoisted installs (the in-repo test brands are npm workspaces of this monorepo) the ensure step walks up and writes the correct depth, e.g. `@../../node_modules/@omega.js/AGENTS.md`.
- The service resolves the monorepo through the installed manager package's real path (the local-era `file:` symlink), so the link always lands on the LIVE top-level map — framework edits are instantly visible to every brand session.
- Non-Claude agents read `AGENTS.md` but don't follow `@` imports — the import line itself names the target path for them.

## Maintenance

`npm run manage` (the manage cycle's `workspace` service, `agents` op — `packages/manager/src/services/workspace/ensure/agents.js`, logic in `src/lib/agents-md.js`):

| State found | Action |
|---|---|
| No `AGENTS.md` | Created: import + brand-notes skeleton |
| Import present at line 1 (right depth) | No-op |
| Import missing / not first / stale depth | Healed: resolved import moved to line 1, duplicates removed, consumer content preserved verbatim |
| No `CLAUDE.md` | Created as the one-line `@AGENTS.md` pointer |
| `CLAUDE.md` carries content | WARNED (never clobbered) with the move-it-to-AGENTS.md message |

Pinned by `packages/manager/test/agents-md.test.js` (no package agent docs + files whitelist, guide-link create/heal/skip against both the local-era and published-install shapes, path resolution, create/heal/idempotence, content preservation).

## Published packages carry their own docs ([#64](https://github.com/Omega-JS-Stack/omega/issues/64))

A consumer install has no monorepo to point at, so the prepare lane ships the knowledge INSIDE each publishable. The devkit vendor hook every framework already runs (`packages/devkit/tools/vendor-docs.js`, called from `tools/vendor.js`) copies, for `@omega.js/{backend,client,desktop,extension,manager,web}`:

| Monorepo source | Shipped as | Notes |
|---|---|---|
| `docs/<package>/` | `<package>/docs/` (flat) | The guide lands at `docs/index.md`, beside the package's committed deep docs; nested dirs (`classy-v2/`) survive |
| `docs/shared/` | `<package>/docs/shared/` | The cross-framework contracts, verbatim |
| `AGENTS.md` (the repo-root map) | `manager/docs/AGENTS.md` | Manager ONLY — the target the brand chain's scope symlink lands on when there is no monorepo. Links retargeted (see below) |
| `agent-plugins/claude/` | `manager/claude-plugin/` + `manager/.claude-plugin/marketplace.json` | Manager ONLY — the plugin every brand enables (see below). `.mcp.json` ships WITH it: since [#144](https://github.com/Omega-JS-Stack/omega/issues/144) it launches `mcp-router-launch.js` inside the plugin, which node-resolves `@omega.js/mcp-router` from the install around it (a real dependency of the manager) instead of addressing the monorepo tree |

The guide's monorepo-relative links are rewritten to the shipped layout on the way in (`../../packages/<self>/` → `../`, `../shared/` → `shared/`), so `docs/index.md` still reaches the package's deep docs, its README, and the shared contracts. Cross-framework links (`../backend/index.md`) are left verbatim — another framework's guide isn't in this tarball.

The map's links are repo-root-relative, so it gets its own pass (`rewriteMapLinks`): `docs/shared/<x>.md` → `shared/<x>.md`, `docs/manager/<x>.md` → `<x>.md` (the manager's guide tree lands flat in the same dir), `docs/<other>/<x>.md` → `../../<other>/docs/<x>.md` (a sibling package under the same `@omega.js` scope), and a `packages/…` or `apps/…` link keeps its words while losing the link — no published target exists. A sibling that never publishes (`devkit`) or isn't installed leaves a dead relative link, the same trade the guide trees already make.

Everything written is GENERATED: gitignored per package, cleared before each rewrite, and pinned by `packages/devkit/test/vendor-docs.test.js` (fixture monorepo) plus `scripts/vendor-docs.test.js`, which packs all six documented packages for real and reads the tarball listings.

Version-matched by construction: the docs in `node_modules/@omega.js/web/docs/` are the docs of the version installed there.

## Brands enable the plugin from their installed manager ([#62](https://github.com/Omega-JS-Stack/omega/issues/62))

The plugin rides in `@omega.js/manager` because that is the package every brand installs. The workspace service's `claude-settings` op writes/heals the brand's committed `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "omega": { "source": { "source": "directory", "path": "./node_modules/@omega.js/manager" } } },
  "enabledPlugins": { "omega@omega": true }
}
```

Committed, so every collaborator's session in that brand loads the omega skills and hooks — a directory marketplace is read LIVE from that path, so `npm update` moves the plugin with the package. The op only fires on a PUBLISHED install: `node_modules/@omega.js/manager` must carry the vendored `.claude-plugin/marketplace.json` **and** be a real directory. A locally linked brand's manager is a SYMLINK into the monorepo — whose `packages/manager` grows that same generated marketplace on every prepare — so the link itself is the local-era signal and the step skips; the developer's own user-scope install covers those sessions. The brand file NEVER points at a monorepo path — it would be machine-specific.

## Packages carry no agent docs (Ian 2026-07-27)

No `packages/<pkg>/` has an `AGENTS.md` or `CLAUDE.md` — deleted outright, no exceptions. Monorepo sessions get the map from the parent walk; consumer brands get it through the maintained scope symlink; a standalone package install has no resolvable chain anyway; the publish era generates whatever a shipped package needs ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).

## The one deliberate gap

- **`apps/sandbox-brand` carries NO agent-docs chain.** It is a synthetic fixture the automated corpus/e2e runs mangle and reset — nothing durable lives there, so nothing agent-facing is written there.

## Editing the guide

The brand-root guide is [docs/manager/brand.md](../manager/brand.md) — framework-owned, brand-agnostic (structure, verbs, per-target required-reading pointers, hard rules). Brand-specific knowledge belongs below the import in that brand's own `AGENTS.md`.

## Per-app docs — RETIRED in brand context (cp246)

Per-app `AGENTS.md`/`CLAUDE.md`/`CHANGELOG.md`/`docs/` scaffolds predate the brand-monorepo era; Claude Code walks parent directories, so the brand-root chain covers app-dir sessions. The shared defaults engine now has a `retire` fileMap rule (devkit `defaults-engine.js`), wired mirrored in all four frameworks' brand branches (detection = the existing `@omega.js/config` brand-root resolution): in a brand app those files NEVER scaffold; an existing framework-owned-only copy (Custom section empty/whitespace or byte-equal to the shipped boilerplate; marker-less files must equal the rendered template) is deleted once, loudly; a copy carrying real consumer content is preserved with a move-it-to-the-brand-root warning. Standalone apps keep full per-app doc scaffolding, and it follows the same shape as a brand root (#63): the framework template is an `AGENTS.md` (marker-merged, so consumer notes below the Custom marker survive every setup) beside a one-line `@AGENTS.md` `CLAUDE.md` pointer. Test-pinned both ways.

**Prior-generation files ([#101](https://github.com/Omega-JS-Stack/omega/issues/101)).** A destination carrying the OMEGA section markers when the current template no longer does is a file an EARLIER generation of the same framework generated — the pre-#63/#91 content-bearing `CLAUDE.md` against today's one-line pointer. Its markers are the framework's own signature, so the engine treats it as framework-owned on both paths: the brand branch retires it (instead of keeping it behind a false "carries consumer content" warning), and on the standalone upgrade path `overwrite: false` still heals it to the current template (instead of leaving a stale doc beside the new `AGENTS.md`). A file with no markers is judged as before — consumer-authored unless it equals the rendered template.
