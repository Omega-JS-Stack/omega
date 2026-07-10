# ========== Default Values ==========
# OMEGA Desktop (@omegajs/desktop) — consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework consumer templates — same sections, same order (framework-specific extras may be inserted; canonical sections are never reordered/renamed). Edit all five together. Canonical skeleton: omega:main skill → resources/mirror-spec.md -->

## Framework

This project consumes **OMEGA Desktop** (@omegajs/desktop) — a comprehensive framework for building modern Electron desktop apps. @omegajs/desktop provides one-line-import bootstrap per Electron process, a modular feature library with file-based extensibility, a multi-platform build/release pipeline (DMG / NSIS / deb / AppImage), and a built-in four-layer test framework.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, Claude MUST read the framework documentation — that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omegajs/desktop/CLAUDE.md`** — top-level overview + index
- **`node_modules/@omegajs/desktop/docs/`** — subsystem deep references (read the relevant ones for the task at hand)

## 🚨 READ WEB-MANAGER TOO

**@omegajs/desktop ships `@omegajs/client` as a runtime singleton inside the renderer process** — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omegajs/client as much as with @omegajs/desktop.

**Required reading:**
- **`node_modules/@omegajs/client/CLAUDE.md`** — top-level overview + index
- **`node_modules/@omegajs/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start           # dev with auto-reload (gulp → webpack → electron .)
npm run build       # local production build (compiles bundles only, no installer)
npm run package     # full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux)
npm run package:quick   # fast packaged build for the host platform/arch only (~20-30s)
npm run release     # signed + published release (requires certs)
npx mgr test        # run framework + project test suites
npx mgr test build/config         # run a specific test by path (relative to test/)
npx mgr test project:             # run ONLY your project tests (all of them)
npx mgr test project:custom-test  # run only consumer project tests matching a path
npx mgr test mgr:                 # run ONLY framework tests (universal alias; em:/framework: are equivalent)
npx mgr test desktop:build/config      # run only framework tests matching a path
npx mgr test --extended           # also run tests that hit REAL external services (off by default; TEST_EXTENDED_MODE=true is the env equivalent — shared name across @omegajs/backend, @omegajs/extension, UJM, and @omegajs/desktop)
# (output is teed to logs/ — dev.log on `npm start`, build.log on `npm run build`, test.log on `npx mgr test`; cat instead of scrolling scrollback)
npx mgr install dev  # use LOCAL @omegajs/desktop source (to test framework edits)
npx mgr install live # restore the published @omegajs/desktop from npm
```

> Editing the @omegajs/desktop framework source while working here? Run `npx mgr install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omegajs/desktop`). Run `npx mgr install live` to switch back.

## Where things live

- `config/omega.json5` — the single OMEGA config (JSON5): shared sections (brand, analytics, payment, firebaseConfig, sentry, theme) at the top level; desktop settings (app, platforms, autoUpdate, startup, releases, downloads, remoteConfig, restartManager) under `targets.desktop`.
- Packaging config — fully generated. @omegajs/desktop produces `dist/electron-builder.yml` from `config/omega.json5` (brand/app/signing) + @omegajs/desktop's opinionated defaults. Consumers never ship an `electron-builder.yml`. Override defaults via the `electronBuilder:` block in `omega.json5` if you genuinely need to.
- `hooks/notarize/post.js` — optional post-notarize extension hook (@omegajs/desktop owns the actual `afterSign` notarize step).
- `src/main.js` — main-process entry. One-line bootstrap of `@omegajs/desktop/main`.
- `src/preload.js` — preload entry. Exposes `window.em` via contextBridge.
- `src/integrations/tray/index.js` — tray definition. Edit this; it's yours.
- `src/integrations/menu/index.js` — application menu definition.
- `src/integrations/context-menu/index.js` — right-click menu definition (called per-event with `params`).
- `src/views/<window>/index.html` — per-window HTML.
- `src/assets/js/components/<window>/index.js` — renderer entry per window.
- `src/assets/scss/main.scss` — shared SCSS.
- `config/icons/<platform>/<slot>.png` — optional icon overrides (`macos/icon.png`, `macos/tray.png`, `macos/dmg.png`, `windows/icon.png`, etc.). Ship ONE file per slot at the native (retina) size — @omegajs/desktop auto-downscales @1x variants. macOS tray must be 32×32 (@omegajs/desktop renames to `trayTemplate.png` in dist for the OS dark-mode magic). Missing slots fall back to @omegajs/desktop bundled defaults; Linux falls back to Windows resolution.
- `test/**/*.js` — your project test suites (framework auto-runs them alongside its own).

## Per-context imports

```js
// src/main.js
new (require('@omegajs/desktop/main'))().initialize();   // auto-loads JSON5 config

// src/preload.js
new (require('@omegajs/desktop/preload'))().initialize();

// src/assets/js/components/main/index.js
new (require('@omegajs/desktop/renderer'))().initialize();
```

## Available APIs at runtime

In main: `manager.storage`, `manager.ipc`, `manager.windows`, `manager.tray`, `manager.menu`, `manager.contextMenu`, `manager.startup`, `manager.appState`, `manager.deepLink`, `manager.autoUpdater`, `manager.sentry`, `manager.webManager`, `manager.context`, `manager.usage`, `manager.remoteConfig`, `manager.analytics`, `manager.restartManager`.

In renderer: `window.em.storage`, `window.em.ipc`, `window.em.logger`, `EM_BUILD_JSON.config`.

## Dependency resolution

- **Do NOT install framework dependencies directly** (`firebase`, `fs-jetpack`, `@omegajs/client`, etc.). @omegajs/desktop's webpack config resolves them through the framework's own `node_modules/`. If something doesn't resolve, the issue is in @omegajs/desktop's webpack config — not your `package.json`.
- **@omegajs/client owns Firebase.** Never `require('firebase')` or `import('firebase/app')`. Use `require('@omegajs/client')` → `webManager.auth()`, `webManager.firestore()` in renderers. In main process, use `manager.webManager` (the @omegajs/desktop bridge).
- **`Manager.require(name)`** resolves from @omegajs/desktop's module context at runtime for unbundled code (gulp tasks, test fixtures).

## Testing

Every feature ships with tests at every layer it has a surface in: **logic** (`test/build/`, `test/main/`), **UI** (`test/renderer/` — real events on the real DOM), and **end-to-end** (`test/boot/`). Skip a layer only when the feature genuinely has no surface there — "the logic test covers it" does not excuse the UI test. Test runs are invisible and never steal keyboard focus (@omegajs/desktop test stealth; set `EM_TEST_SHOW=1` to watch a run live). See `test/README.md` and `node_modules/@omegajs/desktop/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten on every `npx mgr setup`. Add your project-specific notes below — they are preserved across setups. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across `npx mgr setup` runs.
