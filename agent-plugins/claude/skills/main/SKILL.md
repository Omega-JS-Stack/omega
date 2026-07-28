---
name: main
description: OMEGA ecosystem hub — the package roster and which skill routes each one, the docs topology, the brand map, and where project state lives. Orients a session; the guides teach. - Use when working across more than one OMEGA framework, when working in the monorepo itself, or when the right home for a change is not yet known. Triggers on "OMEGA", "omega monorepo", "the monorepo", "@omega.js", "which package", "which framework", "cross-framework", "shared docs", "docs/shared", "omega.json5", "the brands", "sandbox-brand", "omega-playground", "newsflash-brand", "omega-brand", "which brand", "the omega plugin", "omega skills", "project state", "the queue", "full stack", "every framework", "all the frameworks", or any question about where a fact or a change belongs.
user-invocable: true
---

# OMEGA — the hub

The `@omega.js` framework ecosystem lives in ONE monorepo: npm workspaces under `packages/`, test brands under `apps/`, changesets for independent versioning. Start at the repo root `AGENTS.md` — it is the map, and it carries the hard rules (the legacy manager repos are read-only; nothing publishes until the proving checkpoint). This skill orients; every fact belongs to a guide below.

## The roster

| Package | Skill | Guide |
|---|---|---|
| `@omega.js/web` | `omega:web` | `docs/web/index.md` |
| `@omega.js/backend` | `omega:backend` | `docs/backend/index.md` |
| `@omega.js/desktop` | `omega:desktop` | `docs/desktop/index.md` |
| `@omega.js/extension` | `omega:extension` | `docs/extension/index.md` |
| `@omega.js/client` | `omega:client` | `docs/client/index.md` |
| `@omega.js/manager` | `omega:manager` | `docs/manager/index.md` |
| `@omega.js/devkit` | — | `docs/devkit/index.md` |
| `@omega.js/config` | — | `docs/shared/config.md` |
| `@omega.js/account` | — | `packages/account/src` |
| `@omega.js/template-kit` | — | `docs/web/template-kit.md` |
| `@omega.js/mcp-router` | `omega:browser` | `docs/mcp-router/index.md` |

Every framework ships the same context-aware `omega` / `omg` / `mgr` dispatcher: the nearest `package.json` walking up from cwd names the framework whose CLI runs.

## The docs topology

`docs/` is the SSOT. Cross-framework contracts are `docs/shared/*.md` — config, local-dev, testing, deploys, updates, publishing, icons, theming, translation, agent-docs, brands, rulings. Each framework's guide is `docs/<framework>/index.md` with its deep docs beside it, and the package's own `README.md` carries long-form detail. The four framework guides (web, backend, extension, desktop) mirror each other section for section — each guide's header states the rule.

The repo-root `AGENTS.md` is the ONE agent entry — packages carry no agent docs (the parent walk hands every monorepo session the map). Consumer brands import `node_modules/@omega.js/AGENTS.md`, a symlink the workspace service maintains at the map. The brand-root guide is `docs/manager/brand.md`; the contract is `docs/shared/agent-docs.md`.

## The brands

Brand work happens in one of four places — resolve which before touching files, never guess a path:

| Brand | What it is |
|---|---|
| `apps/sandbox-brand` | Synthetic fixture; test runs mangle and reset it |
| `apps/omega-playground` | "Paperloom" — the standing live test brand, classy theme |
| `apps/newsflash-brand` | "The Daily Build" — the second-skin brand, newsflash theme |
| `../omega-brand` | The REAL brand, omegajs.dev — a sibling repo, LIVE |

Nothing in this monorepo is ever the production brand. Topology, history, and the local-era `file:` dependency contract: `docs/shared/brands.md`. Linking a brand against the local frameworks: `docs/shared/local-dev.md`.

## Project state

Live work is GitHub issues (project-state spec v4): the queue is a query (`gh issue list`), status labels carry state, and a spec is the `## Spec` section of its issue — never a file. Shipped work is `CHANGELOG.md`; durable rulings from the retired board era are `docs/shared/rulings.md`.
