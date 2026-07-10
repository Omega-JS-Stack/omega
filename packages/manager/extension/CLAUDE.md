# ========== Default Values ==========
# OMEGA Extension (@omega.js/extension) — consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework consumer templates — same sections, same order (framework-specific extras may be inserted; canonical sections are never reordered/renamed). Edit all five together. Canonical skeleton: omega:main skill → resources/mirror-spec.md -->

## Framework

This project consumes **OMEGA Extension** (`@omega.js/extension`) — a comprehensive framework for building modern cross-browser extensions (Chrome, Firefox, Edge, Opera, Brave). The framework provides one-line bootstrap per extension context, a component-based architecture (view + styles + script per context), a multi-browser build/release pipeline that produces store-uploadable zips, cross-context auth synchronization, and a built-in four-layer test framework.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, Claude MUST read the framework documentation — that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/extension/CLAUDE.md`** — top-level overview + index
- **`node_modules/@omega.js/extension/docs/`** — subsystem deep references (read the relevant ones for the task at hand)

## 🚨 READ WEB-MANAGER TOO

**OMEGA Extension ships `@omega.js/client` as a runtime singleton across every extension context** (background service worker, popup, options, sidepanel, content scripts) — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with the extension framework.

**Required reading:**
- **`node_modules/@omega.js/client/CLAUDE.md`** — top-level overview + index
- **`node_modules/@omega.js/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start                   # dev with live reload (gulp → webpack → serve)
npm run build               # production build → dist/ + packaged/<browser>/raw/ + .zip per browser
BXM_IS_PUBLISH=true npm run build   # build + auto-upload to Chrome / Firefox / Edge stores
npx omega test                # run framework + project test suites
npx omega test build/config         # bare path: run tests matching a path in BOTH sources
npx omega test project:             # run ONLY your project tests (project:<path> to narrow)
npx omega test mgr:                 # run ONLY framework tests (extension: / framework: are equivalent aliases)
npx omega test extension:build/config     # run only framework tests matching a path
# Positional target selects which test FILES run; --filter=<substring> matches test NAMES within them
npx omega test --extended           # also run tests that hit REAL external services (off by default; TEST_EXTENDED_MODE=true is the env equivalent — shared name across all OMEGA frameworks)
# (output is teed to logs/ — dev.log on `npm start`, build.log on `npm run build`, test.log on `npx omega test`; cat instead of scrolling scrollback)
npx omega install dev         # use LOCAL @omega.js/extension source (to test framework edits)
npx omega install live        # restore the published @omega.js/extension from npm
```

> Editing the framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/extension`). Run `npx omega install live` to switch back.

Load the unpacked extension in Chrome: point chrome://extensions → "Load unpacked" at `packaged/chromium/raw/`.

## Where things live

- `config/omega.json5` — the single OMEGA config (JSON5): shared sections (brand, firebaseConfig, analytics, sentry, theme) at the top level + `targets.extension` for extension-specific settings. `Manager.getConfig()` returns it RESOLVED (target section overlaid onto the top level). Secrets never live here — they go in `.env` (e.g. `GOOGLE_ANALYTICS_SECRET`).
- `config/messages.json` — i18n source. Auto-translated to 16 languages at build time via the Claude CLI (only missing keys regenerated).
- `config/description.md` — store-listing description (used by the publish step).
- `src/manifest.json` — extension manifest. The framework merges its defaults in at build time; you only need to declare what's specific to your extension.
- `src/views/<context>/index.html` — per-context HTML (popup / options / sidepanel / pages).
- `src/assets/js/components/<context>/index.js` — per-context script entry. One-line bootstrap of `@omega.js/extension/<context>`.
- `src/assets/css/components/<context>/index.scss` — per-context styles.
- `src/assets/js/components/background.js` — MV3 service worker entry. Source of truth for auth + messaging.
- `src/_locales/en/messages.json` — Chrome `__MSG_*__` placeholders (auto-translated to 16 langs at build).
- `hooks/build/{pre,post}.js` — optional lifecycle hooks.
- `test/**/*.js` — your project test suites (framework auto-runs them alongside its own).

## Per-context imports

```js
// src/assets/js/components/popup/index.js
import Manager from '@omega.js/extension/popup';
await new Manager().initialize();

// src/assets/js/components/background.js  (service worker)
import Manager from '@omega.js/extension/background';
await new Manager().initialize();

// Same shape for options / sidepanel / content / page / offscreen
```

## Available APIs at runtime

After `initialize()`, every Manager exposes:
- `manager.extension` — cross-browser `chrome.*` / `browser.*` / `window.*` wrapper
- `manager.logger` — timestamped per-context logger
- `manager.omega` — Web Manager singleton (Firebase, auth, analytics, reactive `data-wm-bind` directives)
- `manager.messenger` — `chrome.runtime.onMessage` listener wired automatically
- `manager.isDevelopment()` / `isProduction()` / `isTesting()` / `getVersion()` — cross-context helpers. `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive; testing wins). Gate side effects on the intentional check (`isProduction()` for prod-only; `isDevelopment() || isTesting()` for local-or-test) — never `!isDevelopment()`.

Auth UI is declarative — add `.auth-signin-btn` / `.auth-signout-btn` / `.auth-account-btn` to buttons; the framework wires them. Show/hide based on auth state via `data-wm-bind="@show auth.user"`.

## Dependency resolution

- **Do NOT install framework dependencies directly** (`firebase`, `@omega.js/client`, etc.). the framework's webpack config resolves them through the framework's own `node_modules/`. If something doesn't resolve, the issue is in the framework's webpack config — not your `package.json`.
- **@omega.js/client owns Firebase.** Never `import firebase from 'firebase/app'`. Use `import omega from '@omega.js/client'` → `omega.auth()`, `omega.firestore()`.
- **`Manager.require(name)`** resolves from the framework's module context at runtime for unbundled code (gulp tasks, test fixtures).

## Testing

Every feature ships with tests at every layer it has a surface in: **logic** (`test/build/`, `test/background/`), **UI** (`test/view/` — real events on the real DOM), and **end-to-end** (`test/boot/`). Skip a layer only when the feature genuinely has no surface there — "the logic test covers it" does not excuse the UI test. See `test/README.md` and `node_modules/@omega.js/extension/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten on every `npx omega setup`. Add your project-specific notes below — they are preserved across setups. -->

# ========== Custom Values ==========
This project consumes **Browser Extension Manager** (BXM) — a comprehensive framework for building modern cross-browser extensions (Chrome, Firefox, Edge, Opera, Brave). BXM provides one-line bootstrap per extension context, a component-based architecture (view + styles + script per context), a multi-browser build/release pipeline that produces store-uploadable zips, cross-context auth synchronization, and a built-in four-layer test framework.
**BXM ships `@omega.js/client` as a runtime singleton across every extension context** (background service worker, popup, options, sidepanel, content scripts) — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with BXM.
> Editing the BXM framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/extension`). Run `npx omega install live` to switch back.
- `config/@omega.js/extension.json` — JSON5 config: brand, manifest overrides, build settings, theme. `Manager.getConfig()` reads this.
- `src/manifest.json` — extension manifest. BXM merges its defaults in at build time; you only need to declare what's specific to your extension.
Auth UI is declarative — add `.auth-signin-btn` / `.auth-signout-btn` / `.auth-account-btn` to buttons; BXM wires them. Show/hide based on auth state via `data-wm-bind="@show auth.user"`.