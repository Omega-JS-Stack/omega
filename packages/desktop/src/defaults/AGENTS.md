# ========== Default Values ==========
# OMEGA Desktop (@omega.js/desktop) — consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework consumer templates (src/defaults/AGENTS.md ×N) — same sections, same order (framework-specific extras may be inserted; canonical sections are never reordered/renamed). Edit every framework consumer template together. The mirroring rule lives in each framework guide's Doc-update parity section (docs/<framework>/index.md) -->

## Framework

This project consumes **OMEGA Desktop** (@omega.js/desktop) — a comprehensive framework for building modern Electron desktop apps. @omega.js/desktop provides one-line-import bootstrap per Electron process, a modular feature library with file-based extensibility, a multi-platform build/release pipeline (DMG / NSIS / deb / AppImage), and a built-in four-layer test framework.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, the agent MUST read the framework documentation — that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`** — the OMEGA map, the one agent entry into the framework docs; follow it to `docs/desktop/index.md` (the @omega.js/desktop guide: identity, architecture, conventions)
- **`node_modules/@omega.js/desktop/docs/`** — subsystem deep references (read the relevant ones for the task at hand)

## 🚨 READ @omega.js/client TOO

**@omega.js/desktop ships `@omega.js/client` as a runtime singleton inside the renderer process** — it powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with @omega.js/desktop.

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`** → `docs/client/index.md` — the @omega.js/client guide: identity, module list, conventions
- **`node_modules/@omega.js/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start           # dev with auto-reload (gulp → webpack → electron .)
npm run build       # local production build (compiles bundles only, no installer)
npm run package     # full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux)
npm run package:quick   # fast packaged build for the host platform/arch only (~20-30s)
npm run release     # signed + published release (requires certs)
npx omega test        # run framework + project test suites
npx omega test build/config         # run a specific test by path (relative to test/)
npx omega test project:             # run ONLY your project tests (all of them)
npx omega test project:custom-test  # run only consumer project tests matching a path
npx omega test mgr:                 # run ONLY framework tests (universal alias; em:/framework: are equivalent)
npx omega test desktop:build/config      # run only framework tests matching a path
npx omega test --extended           # also run tests that hit REAL external services (off by default; TEST_EXTENDED_MODE=true is the env equivalent — shared name across @omega.js/backend, @omega.js/extension, UJM, and @omega.js/desktop)
# (output is teed to logs/ — dev.log on `npm start`, build.log on `npm run build`, test.log on `npx omega test`; cat instead of scrolling scrollback)
npx omega install dev  # use LOCAL @omega.js/desktop source (to test framework edits)
npx omega install live # restore the published @omega.js/desktop from npm
```

> Editing the @omega.js/desktop framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/desktop`). Run `npx omega install live` to switch back.

## Where things live

- `config/omega.json5` — the single OMEGA config (JSON5): shared sections (brand, analytics, payment, cloud, monitoring, theme) at the top level; desktop settings (app, platforms, autoUpdate, startup, releases, downloads, remoteConfig, restartManager) under `targets.desktop`.
- Packaging config — fully generated. @omega.js/desktop produces `dist/electron-builder.yml` from `config/omega.json5` (brand/app/signing) + @omega.js/desktop's opinionated defaults. Consumers never ship an `electron-builder.yml`. Override defaults via the `electronBuilder:` block in `omega.json5` if you genuinely need to.
- `hooks/notarize/post.js` — optional post-notarize extension hook (@omega.js/desktop owns the actual `afterSign` notarize step).
- `src/main.js` — main-process entry. One-line bootstrap of `@omega.js/desktop/main`.
- `src/preload.js` — preload entry. Exposes `window.desktop` via contextBridge.
- `src/integrations/tray/index.js` — tray definition. Edit this; it's yours.
- `src/integrations/menu/index.js` — application menu definition.
- `src/integrations/context-menu/index.js` — right-click menu definition (called per-event with `params`).
- `src/views/<window>/index.html` — per-window HTML.
- `src/assets/js/components/<window>/index.js` — renderer entry per window.
- `src/assets/scss/main.scss` — shared SCSS.
- `config/icons/<platform>/<slot>.png` — optional icon overrides (`macos/icon.png`, `macos/tray.png`, `macos/dmg.png`, `windows/icon.png`, etc.). Ship ONE file per slot at the native (retina) size — @omega.js/desktop auto-downscales @1x variants. macOS tray must be 32×32 (@omega.js/desktop renames to `trayTemplate.png` in dist for the OS dark-mode magic). Missing slots fall back to @omega.js/desktop bundled defaults; Linux falls back to Windows resolution.
- `test/**/*.js` — your project test suites (framework auto-runs them alongside its own).

## Per-context imports

```js
// src/main.js
new (require('@omega.js/desktop/main'))().initialize();   // auto-loads JSON5 config

// src/preload.js
new (require('@omega.js/desktop/preload'))().initialize();

// src/assets/js/components/main/index.js
new (require('@omega.js/desktop/renderer'))().initialize();
```

## Available APIs at runtime

In main: `manager.storage`, `manager.ipc`, `manager.windows`, `manager.tray`, `manager.menu`, `manager.contextMenu`, `manager.startup`, `manager.appState`, `manager.deepLink`, `manager.autoUpdater`, `manager.sentry`, `manager.omega`, `manager.context`, `manager.usage`, `manager.remoteConfig`, `manager.analytics`, `manager.restartManager`.

In renderer: `window.desktop.storage`, `window.desktop.ipc`, `window.desktop.logger`, `OMEGA_BUILD_JSON.config`.

## Dependency resolution

- **Do NOT install framework dependencies directly** (`firebase`, `fs-jetpack`, `@omega.js/client`, etc.). @omega.js/desktop's webpack config resolves them through the framework's own `node_modules/`. If something doesn't resolve, the issue is in @omega.js/desktop's webpack config — not your `package.json`.
- **@omega.js/client owns Firebase.** Never `require('firebase')` or `import('firebase/app')`. Use `require('@omega.js/client')` → `omega.auth()`, `omega.firestore()` in renderers. In main process, use `manager.omega` (the @omega.js/desktop bridge).
- **`Manager.require(name)`** resolves from @omega.js/desktop's module context at runtime for unbundled code (gulp tasks, test fixtures).

## Testing

Every feature ships with tests at every layer it has a surface in: **logic** (`test/build/`, `test/main/`), **UI** (`test/renderer/` — real events on the real DOM), and **end-to-end** (`test/boot/`). Skip a layer only when the feature genuinely has no surface there — "the logic test covers it" does not excuse the UI test. Test runs are invisible and never steal keyboard focus (@omega.js/desktop test stealth; set `OMEGA_TEST_SHOW=1` to watch a run live). See `test/README.md` and `node_modules/@omega.js/desktop/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten on every `npx omega setup`. Add your project-specific notes below — they are preserved across setups. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across `npx omega setup` runs.
