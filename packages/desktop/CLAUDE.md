# OMEGA Desktop (@omega.js/desktop)

> **Note for contributors and Claude:** This file is the architectural overview — identity, top-level conventions, and a map to the deep references. The **meat** (per-subsystem APIs, edge cases, behavior tables, defaults lists) lives in `docs/<topic>.md`. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one. Goal: keep this file under 250 lines.

> **Mirrored structure:** @omega.js/backend, UJM, @omega.js/extension, and @omega.js/desktop CLAUDE.md files mirror each other — shared sections (Supply-Chain Security, Development Workflow, File Conventions, etc.) appear in the **same order at the same position** across all four. When adding a section that applies to multiple frameworks, insert it in the same spot in all of them.

## Identity

OMEGA Desktop (@omega.js/desktop) is a comprehensive framework for building modern Electron desktop apps. Sister project to @omega.js/extension and Ultimate Jekyll Manager (UJM). Provides one-line-import bootstrap per Electron process, modular feature library with file-based extensibility, a multi-platform build/release pipeline, and a built-in test framework.

## Recommended skills

- **`omega:em`** — router skill. Auto-loads on desktop-specific keywords (`manager.windows`, `manager.tray`, `electron-builder`, `npx omega setup`, etc.) and points back to this CLAUDE.md + `docs/` (the SSOT), carrying only Claude-workflow hard rules and process checklists.
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## 🚨 READ WEB-MANAGER TOO

**@omega.js/desktop ships `@omega.js/client` as a runtime singleton inside the renderer process** — it powers auth, Firebase, reactive `data-wm-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with @omega.js/desktop.

**Required reading:**
- **`node_modules/@omega.js/client/CLAUDE.md`** — top-level overview + index
- **`node_modules/@omega.js/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick Start

### For Consuming Projects

1. `npm install @omega.js/desktop --save-dev`
2. `npx omega setup` — scaffolds the project (writes `config/omega.json5`, `src/main.js`, `src/preload.js`, per-window renderer entries, and integrations skeletons in `src/integrations/{tray,menu,context-menu}/index.js`).
3. `npm start` — dev (gulp → webpack → electron .)
4. `npm run build` — local production build (compiles bundles only, no installer)
5. `npm run package:quick` — fast packaged build for the host platform/arch only (~20-30s, skips DMG/zip/universal/notarize). Smoke-test packaged-mode behavior locally.
6. `npm run package` — full local production package (DMG/zip/universal-mac, NSIS-win, deb+AppImage-linux). ~3min on mac.
7. `npm run release` — signed + published release (requires certs)
8. `npx omega test` — runs framework + project test suites
   - `npx omega test build/config` — run a specific test by path (relative to `test/`, matches both sources)
   - `npx omega test project:` — run ONLY consumer project tests (no framework suites)
   - `npx omega test project:custom-test` — run only that project test file
   - `npx omega test mgr:` — run ONLY framework tests (universal cross-framework alias for "the manager's own tests")
   - `npx omega test desktop:build/config` — run only framework tests matching a path (`em:` aliases `framework:`, both equivalent to `mgr:`)
   - `--filter=<substring>` matches test NAMES (orthogonal to the path target)
   - `npx omega test --extended` (or `TEST_EXTENDED_MODE=true`) opts into tests that hit real external services (Firebase, analytics, update feeds) — off by default. `TEST_EXTENDED_MODE` is the shared, unprefixed env var across @omega.js/backend, @omega.js/extension, UJM, and @omega.js/desktop; it propagates to every spawned test environment and prints a warning when on. See [docs/test-framework.md](docs/test-framework.md#extended-vs-normal-mode).

### For Framework Development (This Repository)

> **🚫 NEVER use `npx omega ...` from the framework repo.** `npx omega` is for CONSUMER projects only (where the bin is linked in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. — the `scripts` in `package.json` call the local `bin/` directly. This applies to ALL four OMEGA frameworks (@omega.js/backend, UJM, @omega.js/extension, @omega.js/desktop).

1. `npm install`
2. `npm start` — watch + compile `src/` → `dist/` via prepare-package
3. Test in the **designated test consumer** — `../../Deployment-Playground/deployment-playground-desktop` is @omega.js/desktop's consumer for validating framework changes end-to-end (exercise any consumer-level flow there freely: builds, tests, packaging, runtime). From inside it, run `npx omega install dev` to swap @omega.js/desktop to this local repo — required whenever you edit the framework source and want the consumer to pick up the changes (the consumer otherwise keeps its installed `node_modules/@omega.js/desktop`). Reverse with `npx omega install live`.
4. `npm test` — runs the framework's own suites

## Architecture

### Per-process Manager singletons

Each Electron process has its own one-line bootstrap:

```js
// src/main.js
new (require('@omega.js/desktop/main'))().initialize();      // auto-loads JSON5 config

// src/preload.js
new (require('@omega.js/desktop/preload'))().initialize();   // exposes window.em

// src/assets/js/components/<view>/index.js
new (require('@omega.js/desktop/renderer'))().initialize();
```

`manager.initialize()` runs a fixed boot order (startup → ipc → storage → theme → sentry → protocol → deepLink → appState → whenReady → autoUpdater → tray/menu/contextMenu → startup → omega → remoteConfig → remoteScripts → windows). See [docs/boot-sequence.md](docs/boot-sequence.md) for the full ordered list + rationale.

### Lib modules

`src/lib/*.js` — every Electron concern its own module. Each exports a singleton with `initialize(manager)`. Deep dive per module: see `docs/<lib-name>.md`. Authoring guide (initialization contract, adding a new lib, flat-vs-split): [docs/lib-modules.md](docs/lib-modules.md).

| Module | Description |
|---|---|
| `ipc` | typed channel bus, single registration point |
| `storage` | electron-store wrapper, sync main / async renderer via IPC |
| `theme` | system-aware appearance — `nativeTheme.themeSource` ('system'/'light'/'dark'), persisted override, live `<html data-bs-theme>` in every renderer via matchMedia |
| `window-manager` | lazy-creation registry, bounds persistence, Discord-style hide-on-close, inset titlebar, dock-show on first window, re-surface on user re-launch |
| `tray` / `menu` / `context-menu` | file-based definitions; unified id-path API; default templates with id-tagged items |
| `startup` | `mode: 'normal' \| 'hidden'`; `'hidden'` bakes `LSUIElement: true` for zero dock bounce |
| `app-state` | storage-backed launch flags + crash sentinel |
| `protocol` | single-instance lock + scheme registration |
| `deep-link` | unified deep-link dispatch (cold + warm start, mac + win + linux), built-in routes, pattern matching |
| `client-bridge` | main = source-of-truth Firebase Auth, renderers reflect via IPC; session persists via `auth-persistence`; renderers push the @omega.js/client-resolved plan → `getResolvedPlan()` |
| `auth-persistence` | pluggable main-session vault (default: safeStorage OS-keychain encryption; `omega.authPersistence` config) |
| `auto-updater` | electron-updater wrapper, idle-aware install, 30-day pending gate, dev simulation |
| `sentry` | per-context split, auto auth attribution, dev-mode gating |
| `templating` | `{{ }}` token replacement (BXM/UJM convention), used at build time by `gulp/html` |
| `context` | runtime info — `manager.context.{geolocation,client,session,app}` |
| `usage` | `opens` / `hoursTotal` / `hoursThisSession`; crash-safe |
| `remote-config` | "Hot config" fetched from `${brand.url}/data/resources/main.json`, polled hourly |
| `remote-scripts` | Emergency remote code execution — fetches `${brand.url}/data/scripts/main.js`, content-hash dedup, async `manager` + `require` in scope |
| `analytics` | GA4 Measurement Protocol; cross-platform `uuidv5` identity |
| `restart-manager` | external guardian app for crash relaunches — localhost HTTP protocol v1 (register/heartbeat/deregister), silent install when missing (mac zip / win NSIS `/S` / linux AppImage; RM self-updates via its own @omega.js/desktop autoUpdater); split dir ships the protocol SSOT the RM app imports |

### File-based feature definitions

Trays, menus, and context-menus are NOT defined in config — they're defined in JS files the consumer authors at fixed conventional paths (`src/integrations/{tray,menu,context-menu}/index.js`). To opt out, call `manager.{tray,menu,contextMenu}.disable()` at runtime.

All three ship sensible default templates and share a unified id-path API (`.find/.has/.update/.remove/.enable/.show/.hide/.insertBefore/.insertAfter/.appendTo`), implemented once in `src/lib/_menu-mixin.js`. See [docs/tray.md](docs/tray.md), [docs/menu.md](docs/menu.md), [docs/context-menu.md](docs/context-menu.md).

### Windows

@omega.js/desktop does NOT auto-create any windows. Consumers call `manager.windows.create('main', { show: !startup.isLaunchHidden() })` from inside `manager.initialize().then(...)`. Inset titlebar by default; Discord-style hide-on-close on `main`; auto re-surface on user re-launch. See [docs/windows.md](docs/windows.md).

### Icons

Convention-only. Drop PNGs at `config/icons/<platform>/<slot>.png` (platform-specific) or `config/icons/global/<slot>.png` (universal fallback). Resolution per slot: platform → global → (Linux only) windows → bundled default. Ship @2x native size only — @omega.js/desktop downscales the @1x sibling via sharp. macOS tray input is `tray.png` (consumer-friendly); @omega.js/desktop renames the dist output to `trayTemplate.png` for OS dark-mode auto-inversion. No `app.icons` config block. See [docs/icons.md](docs/icons.md).

### Build system

prepare-package copies `src/` → `dist/`; gulp orchestrates webpack (3 targets, all bundled) + electron-builder. `gulp/build-config` generates `dist/electron-builder.yml` + `dist/config/entitlements.mac.plist` from @omega.js/desktop defaults + consumer config. Strategy-pluggable Windows signing (`platforms.win.signing.strategy`: `self-hosted` | `cloud` | `local`). See [docs/build-system.md](docs/build-system.md), [docs/installer-options.md](docs/installer-options.md), [docs/signing.md](docs/signing.md).

### Config flow

`config/omega.json5` (JSON5, in consumer; shared sections top-level + desktop settings under `targets.desktop`) → `Manager.getConfig()` (resolves via `@omega.js/config` — `targets.desktop` overlays the top level, brand-monorepo walk-up included — then applies derived defaults: `app.appId` ← `com.itwcreativeworks.<brand.id>`, `app.productName` ← `brand.name`) → injected into ALL THREE bundles at build time via webpack DefinePlugin as `OMEGA_BUILD_JSON`. Runtime reads `OMEGA_BUILD_JSON.config` first (authoritative in packaged apps); dev falls back to resolving from disk.

Required fields: `brand.id` + `brand.name`. Everything else has defaults. See [docs/installer-options.md](docs/installer-options.md) for the full defaults table.

### Schema validation

Every field in `config/omega.json5` is declared in `@omega.js/config` — the shared OMEGA schema plus the desktop refinements (`TARGET_SCHEMAS.desktop`), vendored into `dist/vendor/config/` and exposed to consumers as `require('@omega.js/desktop/config')`. Runs at boot (hard-fails `manager.initialize()` if invalid) AND in `gulp/audit` (plus build-pipeline extras). See [docs/config-schema.md](docs/config-schema.md).

### Cross-context helpers

Four Managers (main / renderer / preload / build-time) all mix in shared helpers via `attachTo(Manager)`: `isDevelopment()`, `isProduction()`, `isTesting()`, `getWebsiteUrl()`, `getEnvironment()`, `getFunctionsUrl()`, `getApiUrl()`, `getAuthUrl()` (the sign-in URL that round-trips an auth token back into the app via the `auth/token` deep link — never link the bare `/signin` page; apps launch it via **`manager.openAuthFlow()`** (main), which opens the user's REAL default browser and, in dev/test where the custom scheme isn't OS-registered, swaps the final hop for a one-shot nonce-checked loopback listener (RFC 8252) feeding the same deep-link pipeline — `lib/auth-flow.js`). Use these instead of grepping `process.env` ad-hoc. `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive — testing wins over dev); gate side effects on the INTENTIONAL check (`isProduction()` for prod-only, `isDevelopment() || isTesting()` for local-or-test) — never `!isDevelopment()`. See [docs/environment-detection.md](docs/environment-detection.md).

### Test framework

`npx omega test` discovers + runs framework suites (`<@omega.js/desktop>/dist/test/suites/**`) plus consumer suites (`<cwd>/test/**`). Four layers: **build** (plain Node), **main** (spawned Electron), **renderer** (hidden BrowserWindow), **boot** (consumer's actual built bundle for end-to-end smoke tests). See [docs/test-framework.md](docs/test-framework.md), [docs/test-boot-layer.md](docs/test-boot-layer.md).

### Test coverage

Every feature ships with tests at EVERY layer it has a surface in — logic (`build`/`main`), UI (`renderer` — real events on the real DOM), and end-to-end (`boot`). Skip a layer ONLY when the feature genuinely has no surface there (a pure build utility has no UI; a CSS-only tweak has no logic). "The logic test already covers it" is NOT a reason to skip the UI test — logic tests prove the logic, UI tests prove the wiring, boot tests prove the built artifact. See [docs/test-framework.md](docs/test-framework.md).

### Dev logs

Every gulp invocation tees stdout+stderr to `<projectRoot>/logs/dev.log` on `npm start` or `logs/build.log` on a production build/package (`OMEGA_BUILD_MODE=true`) — chosen by build mode, path via `OMEGA_LOG_FILE`; disable with `OMEGA_LOG_FILE=false`. `npx omega test` likewise tees its output to `<projectRoot>/logs/test.log`, and `npm run release` streams the GH Actions run to `logs/ci.log`. When debugging via Claude, prefer `cat logs/dev.log` / `cat logs/test.log` over copy-pasting terminal scrollback. See [docs/logging.md](docs/logging.md).

### CDP debugging (Claude ↔ Electron)

`serve` forwards all `--` CLI flags to the Electron child process. Set `OMEGA_CDP_PORT=9222` (or pass `--remote-debugging-port=9222` via `--`) to expose Chrome DevTools Protocol on that port. Drive the running app with the built-in toolkit — `npx omega cdp status|eval|shot|capture|theme|relaunch|quit` (multi-target by URL substring; `relaunch` IS the dev iterate loop since serve has no watch) — or via the `chrome-devtools-electron` MCP upstream for richer single-page interaction (click, fill, network, traces). See [docs/cdp-debugging.md](docs/cdp-debugging.md).

## CLI

`npx omega <command>` (aliases `em`, `@omega.js/desktop`):

| Command | Description |
|---|---|
| `setup` | scaffold consumer, ensure peer deps, write projectScripts |
| `clean` | remove `dist/`, `release/`, `.cache/` |
| `install` | install peer deps |
| `version` | print versions |
| `test` | run framework + project test suites |
| `build` | shells `gulp build` with `OMEGA_BUILD_MODE=true` |
| `publish` | full sign + notarize + GH release upload (`OMEGA_IS_PUBLISH=true`) |
| `validate-certs` | check cert files, env vars, profile expiration, Keychain identity. Auto-runs at end of `setup` |
| `push-secrets` | encrypt `.env` Default section via libsodium → GH Actions secrets. Auto-runs at end of `setup` when `GH_TOKEN` is set |
| `sign-windows` | strategy-aware EV/cloud/local signer; emits JSONL events for `runner monitor` |
| `runner monitor` | tails `em-signing.log` and pretty-prints signing events |
| `launch` | launch a packaged app with clean env (strips `ELECTRON_RUN_AS_NODE`); auto-discovers `release/<platform>-<arch>/<App>.app`. Aliases: `mgr open` |
| `finalize-release` | `--signed-dir` uploads signed installers; `--publish` flips release Draft→Published |
| `release` | trigger consumer's GH Actions Build & Release workflow, poll-stream logs |

See [docs/releasing.md](docs/releasing.md) for the end-to-end flow.

## Dependency Resolution

- **Consumer code can `require()` any @omega.js/desktop dependency** — webpack's `resolve.modules` includes the framework's own `node_modules/`. Consumer projects do NOT need to `npm install firebase`, `fs-jetpack`, `@omega.js/client`, or any other @omega.js/desktop transitive dep. If a dep doesn't resolve, the fix is in @omega.js/desktop's webpack config — not the consumer's `package.json`.
- **@omega.js/client owns Firebase.** Consumer code NEVER imports Firebase directly (`require('firebase')` / `import('firebase/app')`). Use `require('@omega.js/client')` → `omega.auth()`, `omega.firestore()` in renderers. In main process, use `manager.omega` (the @omega.js/desktop bridge). Same rule in BXM and UJM.
- **`Manager.require(name)`** resolves from @omega.js/desktop's module context at runtime (static + prototype). Use in gulp tasks or unbundled code (e.g. test fixtures). Webpack `resolve.modules` handles the bundled case.

## Development Workflow

- **🚫 NEVER use `npx omega ...` from the framework repo** — `npx omega` is for CONSUMER projects only (where the bin lives in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. — the `scripts` in `package.json` call `node bin/omega-desktop` directly. This applies to ALL four OMEGA frameworks (@omega.js/backend, UJM, @omega.js/extension, @omega.js/desktop).
- **🚫 NEVER run `npm start`** (consumer projects) — it's the user's long-running dev process. Assume it's already running; if it isn't, **instruct the user to run it** rather than running it yourself (running it again kills theirs). To see output, **read the `logs/*.log` files** (`dev.log`, `runtime.log`, `test.log`) — never tail/attach to the process. Running `npx omega test` is fine.
- **After editing files**, verify the gulp watcher recompiled successfully. Check for webpack/sass errors in the console output. A change that breaks the build is not a completed change.
- **Live-test UI changes via CDP.** After code changes compile, use the `chrome-devtools-electron` MCP tools (screenshots, click, evaluate JS, console logs) to verify the change works in the running app. This is the primary way to confirm UI/renderer changes — type-checking and test suites verify code correctness, not feature correctness. See [docs/cdp-debugging.md](docs/cdp-debugging.md) and `~/.claude/mcp-server/servers/chrome-devtools-electron/CLAUDE.md`.

## Supply-Chain Security

All `npm install` calls in CLI commands (`npx omega i`, `npx omega setup`, `npx omega runner`) route through the `safeInstall()` helper (`src/utils/safe-install.js`). It prefixes `sfw` (Socket Firewall) when installed — blocking confirmed malware at the network level before packages reach disk. Falls back to plain npm if sfw isn't available. CI workflows install sfw globally and run `sfw npm ci`. Installs will **fail if sfw detects confirmed malware** in any package in the dependency tree; non-critical CVEs and quality warnings pass through.

## File Conventions

- **CommonJS** (`require()`) throughout. Node 24 runs ESM deps natively via `require()` — no need for dynamic `import()` unless a package is genuinely ESM-only. For ESM-only deps in code that webpack bundles, use a STATIC-specifier `await import(/* webpackMode: "eager" */ 'pkg')` — webpack inlines the module into the consumer's bundle so packaged apps need nothing installed (e.g. `electron-store@11` in `lib/storage.js`). NEVER `webpackIgnore` a dep import: it leaves a runtime resolution that fails in packaged consumers (@omega.js/desktop is a devDependency — it never ships in the asar).
- **Node version auto-synced from Electron.** `npx omega setup` queries `releases.electronjs.org` and writes the consumer's `.nvmrc` to match.
- One `module.exports = ...` per file.
- Logical operators at the **start** of continuation lines.
- Short-circuit early returns rather than nested ifs.
- Prefer **`fs-jetpack`** over `fs-extra`.
- **No backwards compatibility** unless explicitly requested — this is unreleased v1.
- **Lib structure — flat file vs directory split.** Default to flat `src/lib/<name>.js`. Split into a directory (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context has materially different logic. Currently only `lib/sentry/` is split. Don't split prophylactically.
- **Use `app.getAppPath()`, not `process.cwd()`, for runtime path resolution.** In a packaged app, `process.cwd()` is `/`. Use `require('./utils/app-root.js')()` — tries `app.getAppPath()` first, falls back to `process.cwd()` for tests/non-Electron contexts.
- **Zero-trust URL handling — `sanitizeURL` for `shell.openExternal` and friends.** Any dynamic URL passed to `shell.openExternal`, `BrowserWindow.loadURL`, `window.location.href =`, etc. MUST be gated through `require('./utils/sanitize-url.js')` first. Returns the URL unchanged when its protocol is `http:`/`https:`, and `''` for anything else (`javascript:`, `data:`, `file:`, `vbscript:`, `chrome:`, custom schemes). Canonical pattern: `const safe = sanitizeURL(url); if (safe) shell.openExternal(safe);`. Hardcoded URLs constructed entirely from internal constants (e.g. the restart-manager feed URLs built from schema-validated config in `lib/restart-manager/install.js`) bypass — not attacker-controllable. See `src/utils/sanitize-url.js` and the `js:patterns/xss-escaping` skill.
- **`ELECTRON_RUN_AS_NODE` is stripped at the CLI boundary.** When set, Electron silently runs as plain Node — `app` is undefined, no BrowserWindow. The variable leaks from common parent processes (VS Code's Claude Code extension runs as a `node.mojom.NodeService` utility process with the var set). `bin/omega-desktop` and `src/gulp/main.js` both `delete process.env.ELECTRON_RUN_AS_NODE` at the top.

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`CLAUDE.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

**The OMEGA docs are structurally MIRRORED.** This file's section skeleton, the consumer template (`src/defaults/CLAUDE.md`), shared-concept `docs/*.md` filenames, and the `omega:*` skills are identical in structure and order across the sister frameworks (UJM / @omega.js/backend / @omega.js/extension / @omega.js/desktop / MAM — @omega.js/client mirrors the library subset). Never add, rename, or reorder a section here without making the SAME change in every sister repo in the same pass. The canonical skeletons + omission rules live in the `omega:main` skill's `mirror-spec.md` resource.

## Documentation

API references for each subsystem live in `docs/`. **Whenever you make a behavioral change, update both this overview AND the relevant `docs/*.md` deep reference.** Treat docs as a first-class deliverable, not an afterthought.

- [docs/boot-sequence.md](docs/boot-sequence.md) — full `manager.initialize()` ordered list + rationale
- [docs/lib-modules.md](docs/lib-modules.md) — lib initialization contract, adding a new lib, flat-vs-split convention
- [docs/storage.md](docs/storage.md) — main + renderer storage, dot-notation, change broadcasts
- [docs/ipc.md](docs/ipc.md) — typed channel bus
- [docs/windows.md](docs/windows.md) — named windows, bounds persistence, hide-on-close, inset titlebar
- [docs/tray.md](docs/tray.md) — file-based tray
- [docs/menu.md](docs/menu.md) — file-based application menu
- [docs/context-menu.md](docs/context-menu.md) — file-based right-click menus
- [docs/startup.md](docs/startup.md) — launch modes, zero-bounce production
- [docs/app-state.md](docs/app-state.md) — launch flags, crash sentinel
- [docs/deep-link.md](docs/deep-link.md) — cross-platform deep links, single-instance, built-in routes
- [docs/client-bridge.md](docs/client-bridge.md) — Firebase auth state sync across main + renderers, session persistence (safeStorage vault), the renderer @omega.js/client auth cycle (`data-wm-bind` bindings live in every renderer) + the resolved-plan push (`getResolvedPlan()`)
- [docs/auto-updater.md](docs/auto-updater.md) — startup + periodic checks, 30-day pending-update gate, idle-aware install
- [docs/analytics.md](docs/analytics.md) — GA4 Measurement Protocol, cross-platform `uuidv5` identity
- [docs/context.md](docs/context.md) — runtime context block (geolocation, client, session, app)
- [docs/usage.md](docs/usage.md) — opens / hoursTotal / hoursThisSession; clean-exit accumulation
- [docs/remote-config.md](docs/remote-config.md) — "hot config" fetched from brand site
- [docs/remote-scripts.md](docs/remote-scripts.md) — emergency remote code execution, content-hash dedup
- [docs/restart-manager.md](docs/restart-manager.md) — the external guardian app: HTTP protocol v1 (SSOT), silent install, self-updates via its own @omega.js/desktop autoUpdater, threat model
- [docs/config-schema.md](docs/config-schema.md) — canonical schema + validator
- [docs/sentry.md](docs/sentry.md) — per-context split, auto auth attribution
- [docs/templating.md](docs/templating.md) — `{{ }}` token replacement, page vars, HTML pipeline
- [docs/logging.md](docs/logging.md) — runtime logger (main + preload + renderer → one `runtime.log`)
- [docs/themes.md](docs/themes.md) — vendored classy + bootstrap themes, per-page CSS bundles, system-aware appearance (`manager.theme`)
- [docs/tooltips.md](docs/tooltips.md) — Bootstrap JS ships in @omega.js/desktop (prebuilt bundle, Popper inlined): zero-setup auto-initialized tooltips, `window.bootstrap` namespace
- [docs/css.md](docs/css.md) — SCSS architecture: main entry, theme `@use` config, per-window bundles, Bootstrap-first
- [docs/hooks.md](docs/hooks.md) — lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize/post)
- [docs/icons.md](docs/icons.md) — convention-only icon resolution (`global/` + per-platform), retina derivation, macOS Template magic
- [docs/fontawesome.md](docs/fontawesome.md) — Font Awesome Free served from the npm dep (icon semantics shared with web via @omega.js/client's icon-core): `<i class="fa-solid fa-*">` auto-render, `manager.fontawesome.get`
- [docs/ads.md](docs/ads.md) — `[data-omega-ad]` auto-bind to @omega.js/client's ads module (live via MutationObserver): house/company lane ONLY (type pinned 'house' — no AdSense in desktop surfaces)
- [docs/installer-options.md](docs/installer-options.md) — per-target installer config, defaults table
- [docs/signing.md](docs/signing.md) — code signing for macOS + Windows
- [docs/releasing.md](docs/releasing.md) — end-to-end release walkthrough
- [docs/runner.md](docs/runner.md) — Windows EV-token signing runner
- [docs/test-framework.md](docs/test-framework.md) — writing tests, running them, layers
- [docs/test-boot-layer.md](docs/test-boot-layer.md) — the `boot` test layer: consumer end-to-end smoke + @omega.js/desktop's framework self-test from the repo via the bundled fixture (`src/test/fixtures/consumer-app/`) + `OMEGA_TEST_BOOT_PROJECT` (@omega.js/desktop's analog of @omega.js/backend/BXM/UJM `*_TEST_BOOT_PROJECT`)
- [docs/build-system.md](docs/build-system.md) — gulp, webpack, electron-builder pipeline
- [docs/environment-detection.md](docs/environment-detection.md) — `isDevelopment`/`isTesting`/`getApiUrl` etc., adding new helpers
- [docs/common-mistakes.md](docs/common-mistakes.md) — the canonical "don't do this" list
- [docs/audit.md](docs/audit.md) — full-audit check catalog (U-xx universal / DSK-xx / F-xx IDs with severity + scope), protocol + fix loop
- [docs/cdp-debugging.md](docs/cdp-debugging.md) — Claude ↔ Electron via CDP: the `mgr cdp` toolkit (status/eval/shot/capture/theme/relaunch/quit), `OMEGA_CDP_PORT`, MCP setup

`PROGRESS.md` tracks pass-by-pass progress and decisions.
