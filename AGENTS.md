# OMEGA Monorepo

> The entry point. Read this top to bottom (it is short), then follow the map. This file is a MAP, not a manual: the knowledge lives in `docs/` (segregated by framework), and the omega Claude plugin's hooks load it into a session deterministically, by where the work is happening. Keep this file under 250 lines.

## What this is

The `@omega.js` framework ecosystem in one repo: npm workspaces, changesets for independent versioning. Remote: [github.com/Omega-JS-Stack/omega](https://github.com/Omega-JS-Stack/omega) (npm org `omega.js`, GH org `Omega-JS-Stack` — both Ian's, names final).

**Lineage** (the migration story, kept short): OMEGA consolidates the legacy manager ecosystem — backend-manager (BEM) became `@omega.js/backend`; ultimate-jekyll-manager (UJM) was replaced by `@omega.js/web` (rebuilt on Eleventy 3, not ported); electron-manager (EM) became `@omega.js/desktop`; browser-extension-manager (BXM) became `@omega.js/extension`; web-manager (WM) was absorbed into `@omega.js/client` — WM no longer exists as a concept; jekyll-uj-powertools became `@omega.js/template-kit`; omega-manager's brains became `@omega.js/manager`. The legacy repos keep serving production and are read-only reference (HARD RULE 1).

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Every package here is `@omega.js/*`-named; zero npm publishes until Ian finalizes versions.** Old-name releases ship from the LEGACY repos; the monorepo's `pre-*-rename` tags are the backup lane.
3. **Publish policy — internal by default**: private shared packages (`account`, `config`, `devkit`, `template-kit`) are vendored into published frameworks at prepare time and never publish. Published = frameworks + `@omega.js/manager` + `@omega.js/client` (a real runtime dependency of desktop/extension — never vendored). All six publishables carry a mechanical `private: true` latch until the proving checkpoint ([docs/shared/publishing.md](docs/shared/publishing.md)) unlatches them.
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## How knowledge loads (the doctrine)

- **`docs/` is the SSOT.** Cross-framework contracts live in `docs/shared/`; each framework's guide is `docs/<framework>/index.md` with its deep docs beside it. No line budget applies inside `docs/`.
- **AGENTS.md files are pointers, never content.** This file is the repo map; each `packages/<framework>/AGENTS.md` is a thin pointer at its `docs/<framework>/` home (with `CLAUDE.md` = `@AGENTS.md`). Do not inline knowledge into any AGENTS.md — write it in `docs/` and point.
- **Loading is deterministic, not preloaded.** The omega Claude plugin's hooks detect where the chat is working — a `packages/<framework>/` tree here, or an app's target in a consumer repo — and inject the relevant docs then. Nobody reads guides "just in case".
- **The one exception**: `packages/manager/AGENTS.md` is the brand-facing guide SHIPPED to consumer brand roots, imported by their AGENTS.md chain from `node_modules`. It stays exactly where it is. Contract: [docs/shared/agent-docs.md](docs/shared/agent-docs.md).
- **Consumers get version-matched knowledge.** In the local era, `node_modules/@omega.js/*` symlinks into this monorepo, so the pointers resolve as-is. Published packages will carry their docs inside the package (prepare-time vendoring — gated on the publish checkpoint), so the plugin reads knowledge that matches the installed version, never a global copy.

## The Claude plugin

The monorepo ships a Claude Code plugin (`agent-plugins/claude/`, listed by the repo-root marketplace manifest `.claude-plugin/marketplace.json`). It is the ONLY home of the `omega:*` skills — folders and frontmatter names stay plain (`wm`, `bem`, …); Claude Code namespaces them `omega:<skill>` automatically from the plugin manifest's `"name": "omega"`; the old global copies are deleted — plus the hooks that do the deterministic loading above. It serves both audiences: developing this monorepo, and every consumer working on a brand built from these frameworks. Install is AUTOMATIC (Ian 2026-07-27): the repo's committed `.claude/settings.json` registers the marketplace and enables the plugin — Claude Code asks one trust question on first open, then it loads every session. Live plugin development needs `claude --plugin-dir ./agent-plugins/claude` (installed plugins are cache copies) or `/reload-plugins` after edits. The contract: [#62](https://github.com/Omega-JS-Stack/omega/issues/62) until it ships.

## The map — packages

| Package | What it is | The guide |
|---|---|---|
| `@omega.js/web` | Web framework (UJM successor): Eleventy 3 + LiquidJS, sections/themes, asset lanes, translation | [docs/web/index.md](docs/web/index.md) |
| `@omega.js/backend` | Firebase Cloud Functions backend framework: build, test, deploy | [docs/backend/index.md](docs/backend/index.md) |
| `@omega.js/desktop` | Electron desktop framework: build, test, package for macOS/Windows/Linux | [docs/desktop/index.md](docs/desktop/index.md) |
| `@omega.js/extension` | Chrome/Firefox MV3 extension framework | [docs/extension/index.md](docs/extension/index.md) |
| `@omega.js/client` | Shared frontend runtime singleton (Firebase auth, account, analytics, notifications, bindings) embedded by web/desktop/extension | [docs/client/index.md](docs/client/index.md) |
| `@omega.js/manager` | Brand orchestration engine: walks every service in dependency order, reconciles a brand monorepo to its omega.json5 | [docs/manager/index.md](docs/manager/index.md) |
| `@omega.js/devkit` | Internal: shared build-time internals (logger, local linking, CLI router, prompts, deploy/update executors), vendored into every framework | [docs/devkit/index.md](docs/devkit/index.md) |
| `@omega.js/config` | Internal: the omega.json5 loader, schema, merge, validator | [docs/shared/config.md](docs/shared/config.md) |
| `@omega.js/account` | Internal: user/account schema + subscription resolution, shared by backend and client | [packages/account/src](packages/account/src) |
| `@omega.js/template-kit` | Internal: the `uj_*` template filters/tags as engine-neutral JS | [docs/web/template-kit.md](docs/web/template-kit.md) |

## The map — brands

| App | Who it is | Cloud |
|---|---|---|
| `apps/sandbox-brand` | Synthetic fixture for the automated corpus/e2e; test runs may mangle and reset it | Offline, `demo-*` only |
| `apps/omega-playground` | "Paperloom" — the standing LIVE test brand, classy theme | Real-but-throwaway project `omegajs-playground` |
| `apps/newsflash-brand` | "The Daily Build" — the standing second-skin brand, newsflash theme | Offline, `demo-*` only |
| `../omega-brand` (sibling repo) | The REAL brand: omegajs.dev, LIVE | Real project `omegajs` |

The in-repo brands and the playground project are test-only forever; nothing in this monorepo is ever the production brand. Full topology, history, the local-era `file:` dependency contract, and the remaining launch gates: [docs/shared/brands.md](docs/shared/brands.md).

## Getting started (the dev loop)

- Root `npm start` watches every dist-building package concurrently (single-instance lock).
- In a brand's website app, `omega dev --local` links every `@omega.js/*` dep brand-wide from this monorepo and starts the watch; `omega i local` does the same per app. Full contract: [docs/shared/local-dev.md](docs/shared/local-dev.md).
- **Upstream-first**: consumer work on a locally linked brand that reveals a framework-level hole fixes it HERE, in the framework — never as a consumer-side patch to repeat in the next project. The rule (and its "within reason" line) lives in [docs/shared/local-dev.md](docs/shared/local-dev.md) and ships to brand sessions via the brand guide.
- Tests run in lanes: `npm run test:packages` (unit), then corpus/e2e/verts/auth/journey — the full pipeline and when each lane gates is in [docs/shared/testing.md](docs/shared/testing.md).

## CLI bins

Every framework ships `omega` + `omg` + `mgr` — all three are the SAME context-aware dispatcher (`@omega.js/devkit/omega-bin`): the nearest package.json walking up from cwd (including a backend's `functions/`) names the framework, and THAT framework's CLI runs via its `./cli` export — so npm's arbitrary hoist-winner in a brand monorepo is always correct. No app context (fresh dir) → falls back to the HOST framework's CLI with a stderr note, which keeps `omega setup` bootstrap working. `omega-<framework>` bins run their own CLI directly, no dispatch. Docs say `npx omega`; `omg`/`mgr` are supported aliases.

## Config: omega.json5

Single config format everywhere: shared sections (brand, firebaseConfig, analytics, payment, sentry, oauth2, theme) + a `targets` object (key presence = target enabled; any shared key inside a target entry overrides it). Merge chain: `defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>`. Secrets stay in `.env` — the validator hard-fails secret-shaped keys in config. **No dual-read (Ian's call, 2026-07-06)**: frameworks flip to omega.json5 outright; legacy brands convert once via the mapping tables. Owned by `@omega.js/config`. Full reference: [docs/shared/config.md](docs/shared/config.md).

## Docs index

`docs/shared/` — cross-framework contracts:

- [config.md](docs/shared/config.md) — the omega.json5 schema, merge chain, legacy mapping tables
- [local-dev.md](docs/shared/local-dev.md) — local linking + watch mechanics
- [testing.md](docs/shared/testing.md) — the tiered verification pipeline (unit → corpus → e2e → verts → journey)
- [deploys.md](docs/shared/deploys.md) — the deliberate `omega deploy` verb on every target (no push triggers, ever)
- [updates.md](docs/shared/updates.md) — the `omega update` dependency-update contract
- [publishing.md](docs/shared/publishing.md) — the publish proving-checkpoint runbook (gated, not yet run)
- [icons.md](docs/shared/icons.md) — the one Font Awesome mechanism on every surface
- [theming.md](docs/shared/theming.md) — the `--omega-*` design-system contract, shell chrome, motion
- [translation.md](docs/shared/translation.md) — the AI translation engine + config-driven cache
- [agent-docs.md](docs/shared/agent-docs.md) — the agent-docs chain: thin pointers here, the brand chain in consumers
- [brands.md](docs/shared/brands.md) — brand topology, history, the local era
- [rulings.md](docs/shared/rulings.md) — standing rulings from the retired board era

`docs/<framework>/` — each framework's guide (`index.md`) plus its deep docs. Web carries the extra set: [sections.md](docs/web/sections.md) (the sections & components contract), [omega-sections-spec.md](docs/web/omega-sections-spec.md) (the ratified architecture spec), [template-kit.md](docs/web/template-kit.md), [classy-v2/DIRECTION.md](docs/web/classy-v2/DIRECTION.md) (the locked visual spec), [ads-system.md](docs/web/ads-system.md) (the ratified vert/ads architecture).

## Project state

Live work is GitHub issues (project-state spec v4): the queue is a query (`gh issue list`), status labels carry state, and a spec is the `## Spec` section of its issue — never a file. The retired board era's plan files are history in `_attic/plans/` (on disk, out of git); its durable rulings live in [docs/shared/rulings.md](docs/shared/rulings.md).
