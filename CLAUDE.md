# OMEGA Monorepo

> Architectural overview only — deep references live in `docs/<topic>.md`. Keep this file under 250 lines.

## Identity

The OMEGA monorepo holds the `@omegajs` framework ecosystem: the successors to backend-manager (BEM), browser-extension-manager (BXM), electron-manager (EM), web-manager (WM), and ultimate-jekyll-manager (UJM — replaced by the new `@omegajs/web`, not ported). One repo, npm workspaces, changesets for independent versioning.

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Old-name npm releases publish FROM this repo** (`packages/*` keep legacy `name` fields until their gated cutover to `@omegajs/*`).
3. **Publish policy — internal by default**: shared packages (`client`, `account`, `config`, `devkit`, `template-kit`) are `private: true`, bundled into published frameworks at prepare time. Published = frameworks + `@omegajs/manager` only.
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## Config: omega.json5

Single config format everywhere: shared sections (brand, firebaseConfig, analytics, payment, sentry, oauth2, theme) + a `targets` object (key presence = target enabled; values = target config; any shared key inside a target entry overrides it). Merge chain: `defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>`. Secrets stay in `.env` — the validator hard-fails secret-shaped keys in config. **No dual-read (Ian's call, 2026-07-06)**: frameworks flip to omega.json5 outright; legacy brands convert once via the mapping tables in [docs/config.md](docs/config.md). Owned by `@omegajs/config`; EM flipped first (desktop settings under `targets.desktop`, per-OS `targets` renamed `platforms`).

## The plan

The full redesign plan (context, architecture, phases, gates): `/Users/ian/.claude/plans/i-need-you-to-jiggly-salamander.md` (to be migrated into `docs/` as work lands). Track progress in [PROGRESS.md](PROGRESS.md).
