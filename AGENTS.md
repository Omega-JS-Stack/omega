# OMEGA Monorepo

> The entry point. Read this top to bottom (it is short), then follow the map. This file is a MAP, not a manual: the knowledge lives in `docs/` (segregated by framework), and the omega Claude plugin's hooks load it into a session deterministically, by where the work is happening. Keep this file under 250 lines.

## What this is

The `@omega.js` framework ecosystem in one repo: npm workspaces, changesets for independent versioning. Remote: [github.com/Omega-JS-Stack/omega](https://github.com/Omega-JS-Stack/omega) (npm org `omega.js`, GH org `Omega-JS-Stack` — both Ian's, names final).

**Lineage** (the migration story, kept short): OMEGA consolidates the legacy manager ecosystem. The legacy repos keep serving production and are read-only reference (HARD RULE 1).

- backend-manager (BEM) became `@omega.js/backend`; electron-manager (EM) became `@omega.js/desktop`; browser-extension-manager (BXM) became `@omega.js/extension`.
- ultimate-jekyll-manager (UJM) was replaced by `@omega.js/web` (rebuilt on Eleventy 3, not ported); jekyll-uj-powertools became `@omega.js/template-kit`.
- web-manager (WM) was absorbed into `@omega.js/client` — WM no longer exists as a concept; omega-manager's brains became `@omega.js/manager`.

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Every package here is `@omega.js/*`-named; zero npm publishes until Ian finalizes versions.** Old-name releases ship from the LEGACY repos; the monorepo's `pre-*-rename` tags are the backup lane.
3. **Publish policy — internal by default**: private shared packages (`account`, `analytics`, `config`, `devkit`, `monitoring`, `template-kit`) are vendored into published frameworks at prepare time and never publish.
   - Published = frameworks + `@omega.js/manager` + `@omega.js/client` (a real runtime dependency of backend/desktop/extension — never vendored) + `@omega.js/mcp-router` (a real runtime dependency of manager, so the vendored plugin's MCP declaration resolves inside the install — Ian 2026-07-30).
   - All seven publishables carry a mechanical `private: true` latch until the proving checkpoint ([docs/shared/publishing.md](docs/shared/publishing.md)) unlatches them.
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## How knowledge loads (the doctrine)

- **`docs/` is the SSOT.** Cross-framework contracts live in `docs/shared/`; each framework's guide is `docs/<framework>/index.md` with its deep docs beside it. No line budget applies inside `docs/`.
- **This file is the ONE agent entry — packages carry no agent docs.** Agents work at this level; the parent walk hands every session this map, and the map plus the plugin's hooks route to `docs/`. Knowledge lives in `docs/`, never in any AGENTS.md.
  - No `packages/<pkg>/AGENTS.md` or `CLAUDE.md` exists, none — the one lookalike is `packages/manager/docs/AGENTS.md`, a gitignored GENERATED copy of this map the prepare lane vendors for published installs ([#144](https://github.com/Omega-JS-Stack/omega/issues/144)); never read or edit it here.
- **Loading is deterministic, not preloaded.** The omega Claude plugin's hooks detect where the chat is working — a `packages/<framework>/` tree here, or a target's tree in a consumer repo — and inject the relevant docs then. Nobody reads guides "just in case".
- **Consumer brands read THIS file.** A brand root's `AGENTS.md` line-1 import is `@node_modules/@omega.js/AGENTS.md` — a symlink the manager's workspace service maintains, pointing at this map.
  - It resolves to the LIVE file in a locally linked brand, and to the copy prepare vendors into `@omega.js/manager/docs/AGENTS.md` (links retargeted) on a published install.
  - Brand-root knowledge (the target table, the verbs, the brand hard rules, upstream-first) lives in [docs/manager/brand.md](docs/manager/brand.md). Contract: [docs/shared/agent-docs.md](docs/shared/agent-docs.md).
- **Consumers get version-matched knowledge.** In the local era, `node_modules/@omega.js/*` symlinks into this monorepo, so the pointers resolve as-is.
  - Published packages carry their docs inside the package — prepare vendors each guide as `docs/index.md` plus `docs/shared/` ([docs/shared/agent-docs.md](docs/shared/agent-docs.md)) — so the plugin reads knowledge that matches the installed version, never a global copy.

## The Claude plugin

The monorepo ships a Claude Code plugin (`agent-plugins/claude/`, listed by the repo-root marketplace manifest `.claude-plugin/marketplace.json`). It serves both audiences: developing this monorepo, and every consumer working on a brand built from these frameworks.

- It is the ONLY home of the `omega:*` skills — folders and frontmatter names stay plain (`web`, `backend`, …); Claude Code namespaces them `omega:<skill>` automatically from the plugin manifest's `"name": "omega"`; the old global copies are deleted — plus the hooks that do the deterministic loading above.
- Install is AUTOMATIC (Ian 2026-07-27): the repo's committed `.claude/settings.json` registers the marketplace and enables the plugin — Claude Code asks one trust question on first open, then it loads every session.
- Consumer brands get the same deal: the plugin is vendored into `@omega.js/manager` at prepare time and the workspace service writes the brand's `.claude/settings.json` to enable it from `./node_modules/@omega.js/manager` ([docs/shared/agent-docs.md](docs/shared/agent-docs.md)).
- It declares exactly ONE MCP server, in `agent-plugins/claude/.mcp.json`: the `@omega.js/mcp-router` endpoint that lazily proxies the browser, electron, and extension upstreams ([docs/mcp-router/index.md](docs/mcp-router/index.md)) — no other native MCP declarations, anywhere.
- A directory-source marketplace is read LIVE from its path, so an enabled plugin serves the CURRENT files — `/reload-plugins` picks up edits mid-session, and `claude --plugin-dir ./agent-plugins/claude` is only for same-session iteration and edge cases, not for freshness. The contract: [docs/shared/agent-docs.md](docs/shared/agent-docs.md).

## The map — packages

| Package | What it is | The guide |
|---|---|---|
| `@omega.js/web` | Web framework (UJM successor): Eleventy 3 + LiquidJS, sections/themes, asset lanes, translation | [docs/web/index.md](docs/web/index.md) |
| `@omega.js/backend` | Firebase Cloud Functions backend framework: build, test, deploy | [docs/backend/index.md](docs/backend/index.md) |
| `@omega.js/desktop` | Electron desktop framework: build, test, package for macOS/Windows/Linux | [docs/desktop/index.md](docs/desktop/index.md) |
| `@omega.js/extension` | Chrome/Firefox MV3 extension framework | [docs/extension/index.md](docs/extension/index.md) |
| `@omega.js/client` | Shared frontend runtime singleton (Firebase auth, account, analytics, notifications, bindings) embedded by web/desktop/extension | [docs/client/index.md](docs/client/index.md) |
| `@omega.js/manager` | Brand orchestration engine: walks every service in dependency order, reconciles a brand monorepo to its omega.json5 | [docs/manager/index.md](docs/manager/index.md) |
| `@omega.js/mcp-router` | One lazy MCP endpoint per session: a stdio server proxying the browser/extension upstreams, tools cached and children spawned on demand | [docs/mcp-router/index.md](docs/mcp-router/index.md) |
| `@omega.js/devkit` | Internal: shared build-time internals (logger, local linking, CLI router, prompts, deploy/update executors), vendored into every framework | [docs/devkit/index.md](docs/devkit/index.md) |
| `@omega.js/config` | Internal: the omega.json5 loader, schema, merge, validator | [docs/shared/config.md](docs/shared/config.md) |
| `@omega.js/account` | Internal: user/account schema + subscription resolution, shared by backend and client | [packages/account/src](packages/account/src) |
| `@omega.js/analytics` | Internal: the ONE analytics contract — event catalog, per-provider adapters (GA4/Meta/TikTok), guarded browser transport, consent seam | [docs/shared/analytics.md](docs/shared/analytics.md) |
| `@omega.js/monitoring` | Internal: the ONE error-reporting contract — config resolution, release tags, PII scrub, the client-side @omega.js-bundle filter, per-platform SDK entries | [docs/shared/monitoring.md](docs/shared/monitoring.md) |
| `@omega.js/template-kit` | Internal: the `omega_*` template filters/tags as engine-neutral JS | [docs/web/template-kit.md](docs/web/template-kit.md) |

## The map — brands

| Brand | Who it is | Cloud |
|---|---|---|
| `brands/sandbox-brand` | Synthetic fixture for the automated corpus/e2e; test runs may mangle and reset it | Offline, `demo-*` only |
| `brands/omega-playground` | "OMEGA Playground" — the standing LIVE test brand, classy theme | Real-but-throwaway project `omegajs-playground` |
| `brands/newsflash-brand` | "The Daily Build" — the standing second-skin brand, newsflash theme | Offline, `demo-*` only |
| `../omega-brand` (sibling repo) | The REAL brand: omegajs.dev, LIVE | Real project `omegajs` |

The in-repo brands and the playground project are test-only forever; nothing in this monorepo is ever the production brand.

- Full topology, history, the local-era `file:` dependency contract, and the remaining launch gates: [docs/shared/brands.md](docs/shared/brands.md).
- **Working inside a consumer brand right now?** Read [docs/manager/brand.md](docs/manager/brand.md) first — the brand-root anatomy, the verbs, and the brand hard rules.

## Getting started (the dev loop)

- Root `npm start` watches every dist-building package concurrently (single-instance lock).
- Re-preparing EVERY package (pre-ship, or after touching a vendored internal like analytics) is ONE root command: `npm run prepare --workspaces --if-present`. Bare `npm run prepare` fails (no root script); never loop per-package.
- In a brand's website target, `omega dev --local` links every `@omega.js/*` dep brand-wide from this monorepo and starts the watch; `omega i local` does the same per target.
  - Linking is ONE-TIME and durable — never re-run per change; a linked brand just restarts `npm start`.
  - A brand ROOT's `npm start` runs `omega dev`: the whole stack (website + backend) in ONE terminal — never boot the targets separately. Full contract: [docs/shared/local-dev.md](docs/shared/local-dev.md).
- **Upstream-first**: consumer work on a locally linked brand that reveals a framework-level hole fixes it HERE, in the framework — never as a consumer-side patch to repeat in the next project.
  - A consumer session asks first: it surfaces the proposed framework change and waits for Ian's go (or files an issue), never editing the monorepo unprompted.
  - The rule (and its "within reason" line) lives in [docs/shared/local-dev.md](docs/shared/local-dev.md) and ships to brand sessions via the brand guide.
- Tests run in lanes: `npm run test:packages` (unit), then corpus/e2e/verts/auth/journey — the full pipeline and when each lane gates is in [docs/shared/testing.md](docs/shared/testing.md).

## CLI bins

Every framework AND `@omega.js/manager` ship `omega` + `omg` + `mgr` — all are the SAME context-aware dispatcher (`@omega.js/devkit/omega-bin`).

- The nearest package.json walking up from cwd (including a backend's `functions/`) names the framework, and THAT framework's CLI runs via its `./cli` export — so npm's arbitrary hoist-winner in a brand monorepo is always correct.
- No target context (fresh dir) → falls back to the HOST package's CLI with a stderr note, which keeps `omega setup` bootstrap working — and with the manager as host, keeps `npx omega onboard` working in a fresh brand-template clone ([#276](https://github.com/Omega-JS-Stack/omega/issues/276)).
- `omega-<framework>` bins run their own CLI directly, no dispatch. Docs say `npx omega`; `omg`/`mgr` are supported aliases.

## Config: omega.json5

Single config format everywhere: shared sections (brand, cloud, analytics, payment, sentry, oauth2, theme) + a `targets` object (key presence = target enabled; any shared key inside a target entry overrides it). Owned by `@omega.js/config`.

- Merge chain: `defaults ← company ← brand shared ← brand targets.<type> ← local shared ← local targets.<type>`.
- Secrets stay in `.env` — the validator hard-fails secret-shaped keys in config.
- **No dual-read (Ian's call, 2026-07-06)**: frameworks flip to omega.json5 outright; legacy brands convert once via the mapping tables. Full reference: [docs/shared/config.md](docs/shared/config.md).

## Docs index

`docs/shared/` — cross-framework contracts:

- [config.md](docs/shared/config.md) — the omega.json5 schema, merge chain, legacy mapping tables
- [local-dev.md](docs/shared/local-dev.md) — local linking + watch mechanics
- [testing.md](docs/shared/testing.md) — the tiered verification pipeline (unit → corpus → e2e → verts → journey)
- [deploys.md](docs/shared/deploys.md) — the deliberate `omega deploy` verb on every target (no push triggers, ever)
- [updates.md](docs/shared/updates.md) — the `omega update` dependency-update contract
- [publishing.md](docs/shared/publishing.md) — the publish proving-checkpoint runbook (gated, not yet run)
- [icons.md](docs/shared/icons.md) — the one Font Awesome mechanism on every surface
- [logging.md](docs/shared/logging.md) — the one log-tag contract (`[@omega.js/<package>:<module>]`) and its guard
- [theming.md](docs/shared/theming.md) — the `--omega-*` design-system contract, shell chrome, motion
- [translation.md](docs/shared/translation.md) — the AI translation engine + config-driven cache
- [analytics.md](docs/shared/analytics.md) — the event catalog, the placement rule, consent gating, attribution
- [monitoring.md](docs/shared/monitoring.md) — the error-reporting contract: the doctrine, the switches, the release tags, the capture seams
- [agent-docs.md](docs/shared/agent-docs.md) — the agent-docs chain: thin pointers here, the brand chain in consumers
- [breaking-changes.md](docs/shared/breaking-changes.md) — the legacy→OMEGA breaking-changes register: what changed shape, and the by-hand migration step for each
- [brands.md](docs/shared/brands.md) — brand topology, history, the local era
- [rulings.md](docs/shared/rulings.md) — standing rulings from the retired board era

`docs/<framework>/` — each framework's guide (`index.md`) plus its deep docs. Web carries the extra set:

- [sections.md](docs/web/sections.md) (the sections & components contract), [omega-sections-spec.md](docs/web/omega-sections-spec.md) (the ratified architecture spec), [template-kit.md](docs/web/template-kit.md)
- [libs.md](docs/web/libs.md) (the `core/js/libs/` inventory and the `__main_assets__` import idiom), [classy-v2/DIRECTION.md](docs/web/classy-v2/DIRECTION.md) (the locked visual spec), [ads-system.md](docs/web/ads-system.md) (the ratified vert/ads architecture)

## Project state

Live work is GitHub issues (project-state spec v4): the queue is a query (`gh issue list`), status labels carry state, and a spec is the `## Spec` section of its issue — never a file. The retired board era's plan files are history in `_attic/plans/` (on disk, out of git); its durable rulings live in [docs/shared/rulings.md](docs/shared/rulings.md).
