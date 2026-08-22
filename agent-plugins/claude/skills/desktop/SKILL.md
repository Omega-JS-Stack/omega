---
name: desktop
description: Use when working on a brand's desktop app or on @omega.js/desktop itself — Electron main, renderer or preload, windows, tray, menus, ipc, deep links, the auto-updater, or the sign/notarize/release pipeline, in targets/desktop or packages/desktop/.
user-invocable: true
---

# OMEGA Desktop (@omega.js/desktop)

`@omega.js/desktop` builds Electron desktop apps: a one-line-import bootstrap per Electron process, a modular lib layer (windows, tray, menu, context-menu, ipc, storage, theme, deep-link, protocol, app-state, auto-updater, client-bridge, auth-persistence, analytics, usage, remote-config, remote-scripts, restart-manager) extended by file-based definitions, a multi-platform build/sign/notarize/release pipeline, and a built-in test framework. It is the EM successor.

## Where the knowledge lives

This skill routes; the docs are the source of truth. Read the guide BEFORE touching files.

- **Working in this monorepo** — `docs/desktop/index.md` is the guide (per-process singletons, the lib-module table, windows, icons, build system, config flow, CDP debugging, the CLI table). The per-subsystem meat lives in `packages/desktop/docs/*.md`. Cross-framework contracts live in `docs/shared/` (config, theming, icons, deploys, updates, testing, local-dev).
- **Working in a consumer project** — read `docs/desktop/index.md` in the framework monorepo (the local era links `node_modules/@omega.js/desktop` straight into it; published installs will carry the docs inside the package ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).
- **`@omega.js/client` comes with it.** The client singleton runs in the renderer, so any task touching auth, Firestore, subscriptions, notifications, or `data-omega-bind` is client work too — `docs/client/index.md` and the `omega:client` skill.

## Non-negotiables

- **Read the guide before editing.** Which process owns a concern (main is the auth source of truth; renderers reflect via IPC) is the first thing to get right.
- **🚫 Never start the user's long-running processes** (`npm start`, a packaged app's dev loop) — assume they are running.
- **Grep the logs FIRST.** The app's `logs/` holds `dev.log` (the gulp run + the Electron child), `build.log`, `test.log`, and `runtime.log` — the running app's own main/preload/renderer lines. All truncated per launch. Read them instead of relaunching the app to see what it already printed (`docs/shared/logging.md`).
- **Secrets never enter `config/omega.json5`** — `.env` and the OS keychain only.
- **Deploys are deliberate** — only `omega deploy` / `omega publish` ship a release; a commit never does (`docs/shared/deploys.md`).
