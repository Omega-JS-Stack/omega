# OMEGA Brand Monorepo — Agent Guide

> **Framework-owned.** This file ships inside `@omega.js/manager` and is imported by the first line of every brand's root `AGENTS.md` — that's how every brand always reads CURRENT framework guidance without copying it. Never edit this file from a brand (it lives in `node_modules/` and is replaced on update); brand-specific notes belong in the brand's own `AGENTS.md`, below the import.

## What you are working in

A **brand monorepo**: one brand (`config/omega.json5`), npm workspaces, one app per enabled target under `apps/`. The `@omega.js/*` frameworks do the heavy lifting — apps stay thin (config + content + custom routes/pages).

| App dir | Target | Framework | Required reading |
|---|---|---|---|
| `apps/website/` | web | `@omega.js/web` | `node_modules/@omega.js/web/CLAUDE.md` |
| `apps/backend/` | backend | `@omega.js/backend` | `node_modules/@omega.js/backend/CLAUDE.md` |
| `apps/desktop/` | desktop | `@omega.js/desktop` | `node_modules/@omega.js/desktop/CLAUDE.md` |
| `apps/extension/` | extension | `@omega.js/extension` | `node_modules/@omega.js/extension/CLAUDE.md` |

**Before doing ANY work inside an app, read its framework's CLAUDE.md** (paths above) — architecture, conventions, APIs, and gotchas live there, not here.

## Brand root anatomy

- `config/omega.json5` — THE brand config (shared sections + `targets.<type>`; key presence = target enabled). Apps in a brand carry NO config file of their own.
- `.env` — secrets, ALWAYS (the config loader hard-fails secret-shaped keys in omega.json5). Gitignored.
- `.omega/` — durable state, secrets store, run output. Gitignored; never commit it.
- `apps/<target>/` — one workspace per enabled target (see table above).
- `AGENTS.md` / `CLAUDE.md` — this doc chain: `CLAUDE.md` is a one-line `@AGENTS.md` pointer; `AGENTS.md`'s first line imports this file; everything below the import is the brand's own.

## Verbs (the whole interface)

Run from the **brand root**:

```bash
npm start                        # manage: reconcile EVERY service to omega.json5 (idempotent)
npm start -- --service=<name>    # reconcile one service (workspace, github, cloud, cloudflare, …)
npm run dev                      # local dev stack (website + backend by default)
npm run deploy                   # DELIBERATE publish fan-out: each app's own deploy, backend first
```

Run from an **app root** (`apps/<target>/`):

```bash
npx omega setup      # validate config + scaffold/heal framework-owned files
npx omega dev        # this app's dev server/build watch
npx omega test       # the app's test suites
npx omega deploy     # DELIBERATE publish for this target (commits never auto-deploy)
npx omega i local    # link the local framework monorepo (framework development)
npx omega i live     # restore published registry versions
```

`omega`, `omg`, and `mgr` are the same context-aware dispatcher — the nearest app names the framework that runs.

## Hard rules

- **Never edit generated output**: `dist/`, `packaged/`, anything gitignored. Edit `src/`, run the build.
- **Never edit `node_modules/`** — including this file. Framework bugs get fixed in the framework.
- **Secrets never enter omega.json5** — `.env` / `.omega/secrets/` only.
- **Deploys are deliberate**: only `omega deploy` publishes. Commits and pushes never auto-publish.
- **Don't start long-running dev processes the user may already be running** (`npm run dev`, emulators) — assume theirs is up; read the app's `dist/*.log` files for output instead.
- **Framework-owned file sections** (marked `Default Values` / `OMEGA Rules` blocks) are rewritten by `omega setup` — put customizations in the marked custom sections only.
