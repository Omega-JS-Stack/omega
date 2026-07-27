---
name: bxm
description: BXM browser extension component architecture, build system, and development patterns for the browser-extension-manager framework and its consumer projects. - Use when creating, editing, or working with browser extensions built on Browser Extension Manager (BXM). Triggers on "BXM", "browser-extension-manager", "browser extension", "extension component", "extension popup", "extension background", "offscreen document", "chrome extension", "manifest.json", "extension manifest", "store description", "listing description", "description.md", "Chrome Web Store listing", "store listing", "audit", "audit the extension", "code audit", "full audit", or any work on files in src/assets/js/components/, src/views/, src/assets/css/components/, config/browser-extension-manager.json.
user-invocable: true
---

# BXM Browser Extension Patterns

Router skill for **Browser Extension Manager (BXM)** — a build framework for Chrome/Firefox/Edge extensions with webpack bundling, SCSS compilation, Bootstrap theming, live reload, and a standardized component system. Sister project to [BEM](../bem/SKILL.md) (backend), [EM](../em/SKILL.md) (Electron apps), [UJM](../ujm/SKILL.md) (Jekyll/web) — four mirrored frameworks on one ecosystem, same conventions and config shapes.

## Read these first (SSOT)

This skill points; the repo docs are the single source of truth — they ship with every install and always match the installed version. Read the CLAUDE.md for the context you're in, then the `docs/<topic>.md` files relevant to the task:

- **In a consumer project:** the project's own `CLAUDE.md` (framework section + project notes), then `node_modules/browser-extension-manager/CLAUDE.md` → `node_modules/browser-extension-manager/docs/*.md`
- **In the framework repo:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/browser-extension-manager/CLAUDE.md` → `docs/*.md`
- **web-manager runs in popup/options/sidepanel/pages** (auth, Firestore, `data-wm-bind`, utilities): `node_modules/web-manager/CLAUDE.md` → `node_modules/web-manager/docs/*.md` (esp. `bindings.md`, `modules.md`)

CLAUDE.md is a table of contents — the meat lives in `docs/`. Always-relevant references: `docs/common-mistakes.md`, `docs/test-framework.md`, `docs/environment-detection.md`, `docs/logging.md`.

## Hard rules

Summaries only — the SSOT for each is the linked doc.

1. 🚫 **NEVER use `npx mgr ...` from the framework repo** — CONSUMER projects only; framework repos use their own `npm` scripts (repo CLAUDE.md § Development Workflow). Applies to ALL four OMEGA frameworks.
2. 🚫 **NEVER run `npm start`** (consumer projects) — it's the user's long-running dev watcher; assume it's already running, and if it isn't, INSTRUCT the user to start it (don't start it yourself). To see output, read the `logs/*.log` files (`dev.log`, `build.log`, `test.log`) — never tail/attach to the process (`docs/logging.md`). Running `npx mgr test` is fine.
   - **Consumer website dev server URL: `https://localhost:4000` — NEVER the LAN IP.** Cert, port discovery (`.temp/_config_browsersync.yml`), and the browser loop: `docs/cdp-debugging.md`.
3. 🚫 **NEVER edit `dist/`** (including `dist/manifest.json`) — edit `src/` / `config/`; builds regenerate (`docs/build-system.md`).
4. **XSS zero tolerance** — inline `webManager.utilities().escapeHTML(value)` at every sink, `sanitizeURL(url)` for executable URL sinks; never a local helper (`docs/xss-prevention.md`).
5. **web-manager owns Firebase** — never `import firebase`; `import webManager from 'web-manager'` → `webManager.auth()` / `.firestore()` (`docs/common-mistakes.md`).
6. **Never install framework transitive deps in a consumer** — BXM's webpack `resolve.modules` resolves them (`docs/common-mistakes.md`).
7. **Use `extension.*`, never raw `chrome.*`** — cross-browser wrapper (`docs/extension.md`).
8. **Gate env behavior on the intentional check** — `isProduction()` or `isDevelopment() || isTesting()`, never `!isDevelopment()` (`docs/environment-detection.md`).
9. **Every feature ships tests at every layer it has a surface in, and NEVER mock** — real harness only (`docs/test-framework.md`).
10. **Doc parity on every behavioral change** — README + CLAUDE.md + `docs/<topic>.md` + CHANGELOG, after validation.
11. **The OMEGA docs and skills are structurally MIRRORED** — this skill, the repo's CLAUDE.md, the consumer template (`src/defaults/CLAUDE.md`), and shared-concept doc filenames match the sister frameworks section-for-section, in the same order. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

Ordered checklists — every step's details live in the linked doc. Invoked with an argument naming a process (e.g. `/omega:bxm audit`)? Run that process directly.

### Build a feature
1. Read the relevant `docs/<topic>.md` (find it via the CLAUDE.md index).
2. Implement in `src/` following the conventions there (views are HTML fragments; Bootstrap classes first).
3. Confirm the watcher compiled: `tail logs/dev.log` (`docs/logging.md`).
4. Write tests at every surfaced layer — build / background / view / boot (`docs/test-framework.md`).
5. Audit doc parity: README, CLAUDE.md, `docs/<topic>.md`, CHANGELOG.

### Debug a running extension
1. Logs first: `logs/dev.log` for build errors (`docs/logging.md`).
2. The dev build loads from `dist/` as an unpacked extension; BXM's live-reload WebSocket refreshes it on change (`docs/build-system.md`).
3. Match symptoms against `docs/common-mistakes.md` (service-worker-incompatible code, raw `chrome.*`, full-document views, …).

### Run tests
- `npx mgr test [<path>|mgr:<path>|project:<path>]`, output tees to `logs/test.log`; `--extended` for real external APIs (`docs/test-framework.md`).

### Audit (full project or framework)
- ID'd check catalog — universal U-xx (mirrored across all four frameworks) + BXM-xx + framework-repo F-xx — scope auto-detect, persisted report, severity-ordered TodoWrite fix loop: `docs/audit.md`.

### Ship a release
1. `npm run build` — production build for all browsers.
2. `BXM_IS_PUBLISH=true npm run build` — uploads to Chrome / Firefox / Edge stores (`docs/publishing.md`).

### Write the store description
1. Read config (`browser-extension-manager.json`, `messages.json`, `manifest.json`) + component JS to learn what the extension actually does.
2. Rewrite `config/description.md` per the listing format + rules — Bonus/Privacy sections stay EXACTLY as-is (`docs/publishing.md`).
3. Clear stale translation caches (`.cache/translations/description/`, `description` key in `.cache/translate.json`); have the user rebuild.

### Edit the framework from a consumer
- `npx mgr install dev` (use local BXM source) / `npx mgr install live` (restore published) — designated test consumer + workflow in the framework CLAUDE.md.

### Add a new component type (framework work)
- Follow `docs/components.md` — Manager class, defaults, manifest field, package.json export; webpack/html/sass discover automatically.
