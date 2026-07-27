---
name: em
description: EM Electron app architecture, lib modules, build/release pipeline, and test framework patterns for the electron-manager framework and its consumer projects. - Use when creating, editing, or working with desktop apps built on Electron Manager (EM). Triggers on "EM", "electron-manager", "Electron Manager", "Electron app", "electron app", "main process", "renderer", "preload", "BrowserWindow", "contextBridge", "ipcMain", "ipcRenderer", "electron-builder", "electron-updater", "tray", "system tray", "app menu", "context menu", "menu bar", "dock icon", "LSUIElement", "Info.plist", "deep link", "deepLink", "auto-updater", "autoUpdater", "code signing", "notarize", "afterSign", "DMG", "NSIS", "AppImage", "snap package", "restart-manager", "RestartManager", "remote-config", "remoteConfig", "manager.windows", "manager.storage", "manager.ipc", "manager.tray", "manager.menu", "manager.contextMenu", "manager.startup", "manager.appState", "manager.deepLink", "manager.autoUpdater", "manager.sentry", "manager.webManager", "manager.context", "manager.usage", "manager.remoteConfig", "manager.analytics", "manager.restartManager", "npx mgr", "mgr setup", "mgr test", "mgr publish", "mgr launch", "mgr release", "mgr runner", "audit", "audit the app", "code audit", "full audit", "config/electron-manager.json", "config/icons", "config/certs", "config/entitlements", or any work on files in src/lib/, src/integrations/, src/views/, src/assets/, src/gulp/, src/commands/, src/test/, src/config/, src/defaults/, config/electron-manager.json, hooks/.
user-invocable: true
---

# EM Electron Patterns

Router skill for **Electron Manager (EM)** — a comprehensive framework for building modern Electron desktop apps. Sister project to [BEM](../bem/SKILL.md) (backend), [BXM](../bxm/SKILL.md) (browser extensions), [UJM](../ujm/SKILL.md) (Jekyll/web) — four mirrored frameworks on one ecosystem, same conventions and config shapes.

## Read these first (SSOT)

This skill points; the repo docs are the single source of truth — they ship with every install and always match the installed version. Read the CLAUDE.md for the context you're in, then the `docs/<topic>.md` files relevant to the task:

- **In a consumer project:** the project's own `CLAUDE.md` (framework section + project notes), then `node_modules/electron-manager/CLAUDE.md` → `node_modules/electron-manager/docs/*.md`
- **In the framework repo:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager/CLAUDE.md` → `docs/*.md`
- **web-manager runs in every renderer** (auth, Firestore, `data-wm-bind`, utilities): `node_modules/web-manager/CLAUDE.md` → `node_modules/web-manager/docs/*.md` (esp. `bindings.md`, `modules.md`)

CLAUDE.md is a table of contents — the meat lives in `docs/`. Always-relevant references: `docs/common-mistakes.md`, `docs/test-framework.md`, `docs/environment-detection.md`, `docs/logging.md`.

## Hard rules

Summaries only — the SSOT for each is the linked doc.

1. 🚫 **NEVER use `npx mgr ...` from the framework repo** — CONSUMER projects only; framework repos use their own `npm` scripts (repo CLAUDE.md § Development Workflow). Applies to ALL four OMEGA frameworks.
2. 🚫 **NEVER run `npm start`** (consumer projects) — it's the user's long-running dev process; assume it's already running, and if it isn't, INSTRUCT the user to start it (don't start it yourself). To see output, read the `logs/*.log` files (`dev.log`, `runtime.log`, `test.log`) — never tail/attach to the process (`docs/logging.md`). Running `npx mgr test` is fine.
   - **Consumer website dev server URL: `https://localhost:4000` — NEVER the LAN IP.** Cert, port discovery (`.temp/_config_browsersync.yml`), and the browser loop: `docs/cdp-debugging.md`.
3. 🚫 **NEVER edit `dist/` or generated files** (`dist/electron-builder.yml`, entitlements plist) — edit `src/` / `config/`; builds regenerate (`docs/build-system.md`).
4. **web-manager owns Firebase** — never `require('firebase')`. Renderers: `webManager.auth()` / `.firestore()`. Main: `manager.webManager` (`docs/common-mistakes.md`).
5. **Never install framework transitive deps in a consumer** — EM's webpack `resolve.modules` resolves them (`docs/common-mistakes.md`).
6. **Zero-trust URLs** — gate dynamic URLs through `sanitize-url.js` before `shell.openExternal` / `loadURL` (`docs/common-mistakes.md`).
7. **Gate env behavior on the intentional check** — `isProduction()` or `isDevelopment() || isTesting()`, never `!isDevelopment()` (`docs/environment-detection.md`).
8. **Every feature ships tests at every layer it has a surface in, and NEVER mock** — real harness only (`docs/test-framework.md`).
9. **Doc parity on every behavioral change** — README + CLAUDE.md + `docs/<topic>.md` + CHANGELOG, after validation.
10. **The OMEGA docs and skills are structurally MIRRORED** — this skill, the repo's CLAUDE.md, the consumer template (`src/defaults/CLAUDE.md`), and shared-concept doc filenames match the sister frameworks section-for-section, in the same order. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

Ordered checklists — every step's details live in the linked doc. Invoked with an argument naming a process (e.g. `/omega:em audit`)? Run that process directly.

### Build a feature
1. Read the relevant `docs/<topic>.md` (find it via the CLAUDE.md index).
2. Implement in `src/` following the conventions there.
3. Confirm the watcher compiled: `tail logs/dev.log` (`docs/logging.md`).
4. Write tests at every surfaced layer — build / main / renderer / boot (`docs/test-framework.md`).
5. Audit doc parity: README, CLAUDE.md, `docs/<topic>.md`, CHANGELOG.

### Debug a running app
1. Logs first: `logs/runtime.log` (runtime errors), `logs/dev.log` (build errors) (`docs/logging.md`).
2. Live inspection via CDP: launch with `EM_CDP_PORT=9222`, then use the `chrome-devtools-electron` MCP tools — screenshot, evaluate, console (`docs/cdp-debugging.md`).
3. Match symptoms against `docs/common-mistakes.md` (white window, `global is not defined`, un-awaited `windows.create()`, `ELECTRON_RUN_AS_NODE` leak, …).

### Run tests
- `npx mgr test [<path>|mgr:<path>|project:<path>]`, output tees to `logs/test.log`; `--extended` for real external APIs (`docs/test-framework.md`).

### Audit (full project or framework)
- ID'd check catalog — universal U-xx (mirrored across all four frameworks) + EM-xx + framework-repo F-xx — scope auto-detect, persisted report, severity-ordered TodoWrite fix loop: `docs/audit.md`.

### Ship a release
1. Smoke-test packaged mode: `npm run package:quick`.
2. `npm run release` — GH Actions run streams to `logs/ci.log` (`docs/releasing.md`, `docs/signing.md`).

### Edit the framework from a consumer
- `npx mgr install dev` (use local EM source) / `npx mgr install live` (restore published) — designated test consumer + workflow in the framework CLAUDE.md.

### Add a new lib (framework work)
- Follow `docs/lib-modules.md` — initialization contract, boot-order wiring, flat-vs-split, required tests + doc.
