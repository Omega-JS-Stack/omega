# OMEGA Monorepo

> Architectural overview only — deep references live in `docs/<topic>.md`. Keep this file under 250 lines.

## Identity

The OMEGA monorepo holds the `@omega.js` framework ecosystem: the successors to backend-manager (BEM), browser-extension-manager (BXM), electron-manager (EM), web-manager (WM), and ultimate-jekyll-manager (UJM — replaced by the new `@omega.js/web`, not ported). One repo, npm workspaces, changesets for independent versioning. Remote: [github.com/Omega-JS-Stack/omega](https://github.com/Omega-JS-Stack/omega) (npm org `omega.js`, GH org `Omega-JS-Stack` — both Ian's, names final).

## HARD RULES

1. 🚫 **The legacy repos are READ-ONLY.** Never modify `omega-manager`, `backend-manager`, `ultimate-jekyll-manager`, `browser-extension-manager`, `electron-manager`, `mobile-app-manager`, `web-manager`, `jekyll-uj-powertools`, or any consumer brand repo. They are reference/history and keep serving production. All work happens HERE.
2. **Every package here is `@omega.js/*`-named; zero npm publishes until Ian finalizes versions.** Old-name releases (backend-manager@5.x, electron-manager@1.x, …) ship from the LEGACY repos (Ian-owned); the monorepo's `pre-*-rename` tags are the backup lane.
3. **Publish policy — internal by default**: private shared packages (`account`, `config`, `devkit`, `template-kit`) are vendored into published frameworks at prepare time and never publish. Published = frameworks + `@omega.js/manager` + `@omega.js/client` (a real runtime dependency of desktop/extension since the client cutover — never vendored; see [docs/local-dev.md](docs/local-dev.md)).
4. **MAM is parked.** No `packages/mobile`, no mobile work — slot reserved only.
5. **Preserve semantics, replace plumbing.** Blueprints/default-pages, FILE_MAP scaffolding semantics, `mgr i local`, prepare-watch, the frontend↔backend contract, and the disperse model must keep working exactly as consumers expect.
6. **Every extraction/normalization step is gated**: golden-master where applicable, package test suites, cross-stack e2e, canary consumer.

## Config: omega.json5

Single config format everywhere: shared sections (brand, firebaseConfig, analytics, payment, sentry, oauth2, theme) + a `targets` object (key presence = target enabled; values = target config; any shared key inside a target entry overrides it). Merge chain: `defaults ← company ← brand shared ← brand targets.<type> ← app shared ← app targets.<type>`. Secrets stay in `.env` — the validator hard-fails secret-shaped keys in config. **No dual-read (Ian's call, 2026-07-06)**: frameworks flip to omega.json5 outright; legacy brands convert once via the mapping tables in [docs/config.md](docs/config.md). Owned by `@omega.js/config`; EM flipped first (desktop settings under `targets.desktop`, per-OS `targets` renamed `platforms`).

## Local dev loop

Root `npm start` watches every dist-building package concurrently (single-instance lock); `omega dev --local` in a brand's website app links every `@omega.js/*` dep brand-wide from this monorepo and starts the watch; `omega i local` does the same per app. Mechanics: `@omega.js/devkit/local`. Full contract: [docs/local-dev.md](docs/local-dev.md).

## CLI bins

Every framework ships `omega` + `omg` + `mgr` — all three are the SAME context-aware dispatcher (`@omega.js/devkit/omega-bin`): the nearest package.json walking up from cwd (incl. a backend's `functions/`) names the framework, and THAT framework's CLI runs via its `./cli` export — so npm's arbitrary hoist-winner in a brand monorepo is always correct. No app context (fresh dir) → falls back to the HOST framework's CLI with a stderr note, which keeps `omega setup` bootstrap working. `omega-<framework>` bins run their own CLI directly, no dispatch. Docs say `npx omega`; `omg`/`mgr` are supported aliases.

## The plan

The full redesign plan (context, architecture, phases, gates, amendments): [plans/omega-redesign-master-plan.md](plans/omega-redesign-master-plan.md) — vendored in-repo so it survives chat resets. Live status: [PROGRESS.md](PROGRESS.md).
