# OMEGA Desktop (@omega.js/desktop)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/desktop` — identity, top-level conventions, and a map to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** (per-subsystem APIs, edge cases, behavior tables, defaults lists) lives in the package's own [`docs/<topic>.md`](../../packages/desktop/docs) files. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one.

> **Mirrored structure:** the four framework guides (`docs/web/index.md`, `docs/backend/index.md`, `docs/extension/index.md`, and `docs/desktop/index.md`) mirror each other: shared sections (Supply-Chain Security, Development Workflow, File Conventions, Doc-update parity, etc.) appear in the **same order at the same position** across all four. When adding a section that applies to multiple frameworks, insert it in the same spot in all of them. Each consumer template (`src/defaults/AGENTS.md`; web's lives at `scaffold/AGENTS.md`, beside its one-line `@AGENTS.md` `CLAUDE.md` pointer) mirrors its guide the same way.

## Identity

OMEGA Desktop (@omega.js/desktop) is a comprehensive framework for building modern Electron desktop apps, the desktop of the OMEGA family beside @omega.js/web, @omega.js/extension and @omega.js/backend. Each process module's default export is ONE ready-made instance, `omega`. It provides a one-line-import bootstrap per Electron process, a modular feature library with file-based extensibility, a multi-platform build/release pipeline, and a built-in test framework.

## Recommended skills

- **`omega:desktop`** — the router skill from the omega Claude plugin. The inject hook loads it automatically in any project with `@omega.js/desktop` (and inside `packages/desktop` here); it points back to this guide + `docs/` (the SSOT).
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## 🚨 READ @omega.js/client TOO

**@omega.js/desktop's renderer instance extends `@omega.js/client`'s base class**: `omega.auth`, `omega.storage`, `omega.bindings`, `omega.firestore` and the rest of the client are properties of the renderer's `omega`, beside `omega.desktop`, the preload's bridge to main. The client powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with @omega.js/desktop.

**Required reading:**
- **`docs/client/index.md`** (in the framework monorepo) — the client guide: identity, module list, conventions
- **`node_modules/@omega.js/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick Start

### For Consuming Projects

1. `npm install @omega.js/desktop --save-dev`
2. There is no setup step ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)). The project scaffolds itself on the first verb below — `ensureTarget()` writes `config/omega.json5`, `src/main.js`, `src/preload.js`, per-window renderer entries, and integrations skeletons in `src/integrations/{tray,menu,context-menu}/index.js`, idempotently and silently once the target is converged.
3. `npm start` — dev (gulp → esbuild → electron .)
4. `npm run build` — local production build (compiles bundles only, no installer)
5. `npm run package:quick` — fast packaged build for the host platform/arch only (~30s, skips DMG/zip/universal/notarize). Smoke-test packaged-mode behavior locally. Quick mode runs end-to-end (#117) and means exactly ONE thing since [#737](https://github.com/Omega-JS-Stack/omega/issues/737): the trimmed electron-builder phase. `clean` no longer keeps `dist/` and `release/` for it — the "next run is incremental" that justified keeping them was never true (every bundle was rebuilt anyway), and a cold esbuild bundle of all three targets is ~1s.
6. `npm run package`: full local production package, of whatever the `platforms` declaration says the brand ships (by default DMG/zip on mac, NSIS on windows, deb+AppImage+snap on linux). ~3min on mac.
7. `npm run release` — signed + published release (requires certs)
8. `npx omega test` — runs the project's test suites (bare consumer runs never include the framework corpus)
   - `npx omega test build/config` — run project tests by path (relative to `test/`)
   - `npx omega test framework:` / `npx omega test full:` — reach the framework suite (alone, or both sources)
   - `npx omega test project:custom-test` — run only that project test file
   - `npx omega test mgr:` — run ONLY framework tests (universal cross-framework alias for "the manager's own tests")
   - `npx omega test desktop:build/config` — run only framework tests matching a path (`desktop:` is equivalent to `mgr:`)
   - `--filter=<substring>` matches test NAMES (orthogonal to the path target)
   - `npx omega test --extended` (or `TEST_EXTENDED_MODE=true`) opts into tests that hit real external services (Firebase, analytics, update feeds) — off by default. `TEST_EXTENDED_MODE` is the shared, unprefixed env var across @omega.js/backend, @omega.js/extension, UJM, and @omega.js/desktop; it propagates to every spawned test environment and prints a warning when on. See [docs/test-framework.md](../../packages/desktop/docs/test-framework.md#extended-vs-normal-mode).

### For Framework Development (This Repository)

> **🚫 NEVER use `npx omega ...` from the framework repo.** `npx omega` is for CONSUMER projects only (where the bin is linked in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. — the `scripts` in `package.json` call the local `bin/` directly. This applies to ALL four OMEGA frameworks (@omega.js/backend, UJM, @omega.js/extension, @omega.js/desktop).

1. `npm install`
2. `npm start` — watch + compile `src/` → `dist/` via prepare-package
3. Test in the **designated test consumer** — `../../Deployment-Playground/deployment-playground-desktop` is @omega.js/desktop's consumer for validating framework changes end-to-end (exercise any consumer-level flow there freely: builds, tests, packaging, runtime). From inside it, run `npx omega install dev` to swap @omega.js/desktop to this local repo — required whenever you edit the framework source and want the consumer to pick up the changes (the consumer otherwise keeps its installed `node_modules/@omega.js/desktop`). Reverse with `npx omega install live`.
4. `npm test` — runs the framework's own suites

## Architecture

### The consumer entry

Each Electron process's module exports ONE ready-made instance, `omega`; the class is exported by name (`Omega`) for tests only, and a consumer never writes `new`:

```js
// src/main.js
const omega = require('@omega.js/desktop/main');        // auto-loads JSON5 config
omega.initialize().then(() => { const { logger, windows } = omega; });

// src/preload.js
const omega = require('@omega.js/desktop/preload');     // exposes window.desktop
omega.initialize();

// src/assets/js/components/<view>/index.js
import omega from '@omega.js/desktop/renderer';
omega.initialize().then(() => { const { logger, desktop } = omega; });
```

`initialize()` returns the instance, and `omega.ready` is the same promise, so a module that did not call it can still await it. In main, `omega.initialize()` runs a fixed boot order (startup → ipc → storage → theme → fontawesome → sentry → protocol → deepLink → authFlow → appState → context → usage → whenReady → autoUpdater → tray/menu/contextMenu → startup → auth → remoteConfig → remoteScripts → analytics → restartManager → windows). See [docs/boot-sequence.md](../../packages/desktop/docs/boot-sequence.md) for the full ordered list + rationale.

### The instance (`omega`)

- **main**: every lib is a plain property: `omega.windows`, `tray`, `menu`, `contextMenu`, `ipc`, `storage`, `deepLink`, `autoUpdater`, `appState`, `startup`, `protocol`, `authFlow`, `theme`, `fontawesome`, `context`, `usage`, `remoteConfig`, `remoteScripts`, `restartManager`, `analytics`, `sentry`, `logger`, plus `config`, the environment helpers, the URL helpers (`getApiUrl()`, `getWebsiteUrl()`, `getFunctionsUrl()`, `getAuthUrl()`), `quit()`, `relaunch()`, `openAuthFlow()`, `request(url, options)` (the client base's harmonized API fetch, carrying a fresh Bearer token from main's session when signed in) and `require(name)`. `omega.auth` is the signed-in account: `.user` (always a `User`), `.listen()`, `.signOut()`, `.getIdToken()`, `.handleToken()` ([docs/auth.md](../../packages/desktop/docs/auth.md)).
- **preload**: exposes `window.desktop` through `contextBridge`; `omega.logger` and the environment helpers.
- **renderer**: `@omega.js/client`'s base class (`omega.auth`, `omega.storage` the page store, `omega.bindings`, `omega.firestore`, ...) plus `omega.desktop`, the preload's bridge under main's names: `omega.desktop.{ipc,storage,theme,fontawesome,autoUpdater,analytics,context,usage,remoteConfig}`. `omega.desktop.storage` is the app store, async over IPC. The renderer carries the same auth click triggers as the extension's pages: `.omega-signin` runs main's `openAuthFlow()`, `.omega-account` opens the website's `/account` page in the user's browser, and `.omega-signout` (the client's trigger) signs the whole app out through main, whose broadcast then signs every window out ([docs/auth.md](../../packages/desktop/docs/auth.md)).

### Lib modules

`src/lib/*.js`: every Electron concern its own module. Each exports one object with `initialize(omega)`, and main hangs it on the instance by name. Deep dive per module: see `docs/<lib-name>.md`. Authoring guide (initialization contract, adding a new lib, flat-vs-split): [docs/lib-modules.md](../../packages/desktop/docs/lib-modules.md).

| Module | Description |
|---|---|
| `ipc` | typed channel bus, single registration point |
| `storage` | electron-store wrapper, sync main / async renderer via IPC |
| `theme` | system-aware appearance: `nativeTheme.themeSource` ('system'/'light'/'dark'), persisted override, live `<html data-bs-theme>` in every renderer via matchMedia |
| `window-manager` | lazy-creation registry, bounds persistence, Discord-style hide-on-close, inset titlebar, dock-show on first window, re-surface on user re-launch |
| `tray` / `menu` / `context-menu` | file-based definitions; unified id-path API; default templates with id-tagged items |
| `startup` | `mode: 'normal' \| 'hidden'`; `'hidden'` bakes `LSUIElement: true` for zero dock bounce |
| `app-state` | storage-backed launch flags + crash sentinel |
| `protocol` | single-instance lock + scheme registration |
| `fontawesome` | serves the bundled icon SVGs to renderers over IPC (`desktop:fontawesome:get`); the renderer auto-renders `fa-*` markup ([docs/fontawesome.md](../../packages/desktop/docs/fontawesome.md)) |
| `deep-link` | unified deep-link dispatch (cold + warm start, mac + win + linux), built-in routes, pattern matching |
| `auth` | `omega.auth`: main = source-of-truth Firebase Auth, renderers reflect via IPC; session persists via `auth-persistence`; renderers push the account document their client resolved, so main's `omega.auth.user` is the same `User` |
| `auth-flow` | `omega.authFlow` / `omega.openAuthFlow()`: the sign-in round trip in the user's default browser, returning over the deep link (production) or a one-shot loopback listener (dev/test) |
| `auth-persistence` | pluggable main-session vault (default: safeStorage OS-keychain encryption; `omega.authPersistence` config) |
| `auto-updater` | electron-updater wrapper, idle-aware install, 30-day pending gate, dev simulation |
| `sentry` | `@omega.js/monitoring` — the shared error-reporting contract, auto auth attribution, dev-mode gating |
| `templating` | `{{ }}` token replacement, used at build time by `gulp/html` |
| `context` | runtime info: `omega.context.{geolocation,client,session,app}` |
| `usage` | `opens` / `hoursTotal` / `hoursThisSession`; crash-safe |
| `remote-config` | "Hot config" fetched from `${brand.url}/data/resources/main.json`, polled hourly |
| `remote-scripts` | Emergency remote code execution: OPT-IN (`remoteScripts.enabled: true`) + https-only; fetches `${brand.url}/data/scripts/main.js`, content-hash dedup, async `omega` + `require` in scope |
| `analytics` | GA4 Measurement Protocol; cross-platform `uuidv5` identity; the app's ONE sender — renderer events forward here over IPC ([docs/analytics.md](../../packages/desktop/docs/analytics.md)) |
| `restart-manager` | external guardian app for crash relaunches — localhost HTTP protocol v1 (register/heartbeat/deregister), silent install when missing (mac zip / win NSIS `/S` / linux AppImage; RM self-updates via its own @omega.js/desktop autoUpdater); split dir ships the protocol SSOT the RM app imports |

### File-based feature definitions

Trays, menus, and context-menus are NOT defined in config: they're defined in JS files the consumer authors at fixed conventional paths (`src/integrations/{tray,menu,context-menu}/index.js`). To opt out, call `omega.{tray,menu,contextMenu}.disable()` at runtime. Each file exports one function of an object: `({ omega, tray })`, `({ omega, menu, defaults })`, and `({ omega, menu, params, webContents })` for the context menu, called per right-click.

All three ship sensible default templates and share a unified id-path API (`.find/.has/.update/.remove/.enable/.show/.hide/.insertBefore/.insertAfter/.appendTo`), implemented once in `src/lib/_menu-mixin.js`. See [docs/tray.md](../../packages/desktop/docs/tray.md), [docs/menu.md](../../packages/desktop/docs/menu.md), [docs/context-menu.md](../../packages/desktop/docs/context-menu.md).

### Windows

@omega.js/desktop does NOT auto-create any windows. Consumers call `omega.windows.create('main', { show: !startup.isLaunchHidden() })` from inside `omega.initialize().then(...)`. Inset titlebar by default; Discord-style hide-on-close on `main`; auto re-surface on user re-launch. See [docs/windows.md](../../packages/desktop/docs/windows.md).

### Icons

Convention-only. Drop PNGs at `config/icons/<platform>/<slot>.png` (`mac`, `windows`, `linux`: the one vocabulary, #867) or `config/icons/global/<slot>.png` (universal fallback). Resolution per slot: platform → global → (Linux only) windows → bundled default. Ship @2x native size only; @omega.js/desktop downscales the @1x sibling via sharp. macOS tray input is `tray.png` (consumer-friendly); @omega.js/desktop renames the dist output to `trayTemplate.png` for OS dark-mode auto-inversion. No `app.icons` config block. See [docs/shared/icons.md](../../packages/desktop/docs/icons.md).

### Build system

prepare-package copies `src/` → `dist/`; gulp orchestrates esbuild (3 bundles, all bundled) + electron-builder. The bundler is @omega.js/devkit's ONE `bundle()` wrapper since [#737](https://github.com/Omega-JS-Stack/omega/issues/737): webpack and its loaders are gone from desktop, and the task went with the name: `src/gulp/tasks/bundle.js`, gulp task `bundle`, log tag `[@omega.js/desktop:bundle]`. An ESM-only dependency bundles into main and preload like any other: both are CommonJS output, where the wrapper keeps `import.meta.url` answering ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)), so a package that opens a require of its own with `createRequire(import.meta.url)` runs bundled instead of throwing at boot. `gulp/build-config` generates `dist/electron-builder.yml` + `dist/config/entitlements.mac.plist` from @omega.js/desktop defaults + consumer config. What the app SHIPS is one declaration, `platforms.<mac|windows|linux>.formats.<dmg|nsis|deb|appimage|snap>` ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)): presence = enabled, every format defaults on, `false` drops one, and the electron-builder target lists derive from it. Artifact names carry NO version (`<Product>-mac-dmg.dmg`) and come from @omega.js/config's `platforms.js`: the ONE table the website's `/download/<platform>/<format>` URLs read too ([#620](https://github.com/Omega-JS-Stack/omega/issues/620)), so `/releases/latest/download/<asset>` is permanent and a desktop release never touches the site. The `.deb` target's two required metadata facts come from the BRAND ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): `linux.maintainer` from `brand.name` plus `brand.contact.email`, and the homepage from `brand.url` through `extraMetadata` (electron-builder reads it off the app manifest, never off its own config); a brand missing either fails at config generation, naming the key, instead of at package time after the AppImage has already uploaded. Strategy-pluggable Windows signing (`platforms.windows.signing.strategy`: `self-hosted` | `cloud` | `local`), whose value is also what the env schema gates each signing credential on, so the walk asks for one strategy's set and no other's. See [docs/releasing.md](../../packages/desktop/docs/releasing.md) for the whole release contract (one public repo, always `<brand.id>-releases`, the survivor + never-reuse rules, the asset table), [docs/build-system.md](../../packages/desktop/docs/build-system.md), [docs/installer-options.md](../../packages/desktop/docs/installer-options.md), [docs/signing.md](../../packages/desktop/docs/signing.md).

The ACCENT comes from the config, not from a literal a consumer keeps in sync
([#912](https://github.com/Omega-JS-Stack/omega/issues/912)): `gulp/sass` renders
`dist/assets/scss/_brand.scss` from `brand.color` before every compile, carrying
`$primary` (what Bootstrap's color ramp derives from) plus a `ramp` mixin of the
runtime `--omega-accent` family, and the scaffold's `main.scss` reads both,
`@use 'brand';` above the framework import and `@include brand.ramp;` below it
(below, because a used module's css emits at its load position, ahead of the
token sheet the ramp has to beat). A deliberate divergence puts a literal back in
place of `brand.$primary`. Same renderer @omega.js/extension writes and the same
ramp web inlines into its `<head>`: [shared/theming.md](../shared/theming.md).

### Signing material is READ IN PLACE, and the paths derive ONCE ([#891](https://github.com/Omega-JS-Stack/omega/issues/891))

Nothing copies signing material into a target. The signing tree is read where it lives, in TWO tiers ([#892](https://github.com/Omega-JS-Stack/omega/issues/892), `@omega.js/devkit/signing-tree`): the COMPANY's `<company tree>/.omega/certificates/apple/` first when the brand names one with `company: { id }` and that company is on this machine ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)), the brand's own second, so a brand of a company signs with the company's material and falls back to its own only for a file the company tree does not hold. The manager's disperse `certs` operation, devkit's `deliverCerts()` and desktop's `deliver-certs.js` are all gone with the copy: one fact, one home, and no dispersed duplicate a build could silently sign with after the tree moved on.

`CSC_LINK` and `APPLE_API_KEY` DERIVE from that tree, ONCE, at the desktop env load ([src/utils/load-env.js](../../packages/desktop/src/utils/load-env.js), over `@omega.js/devkit/signing-env`), which both boots call: the CLI (`src/cli.js`) and gulp (`src/gulp/main.js`, its own process under `npm start`). `CSC_LINK` takes the tree's `certificates/DEVELOPER_ID_APPLICATION_G2.p12` when `CSC_KEY_PASSWORD` OPENS it, `APPLE_API_KEY` takes its `AuthKey_<APPLE_API_KEY_ID>.p8`, and both are ABSOLUTE paths. An explicit env value always wins, a file that exists and cannot be used prints one line and leaves the key unset (electron-builder's Keychain discovery stays the default), and no provisioning profile derives at all: Developer ID is direct distribution and needs none. The build, `validate-certs` and the deploy precheck's secret publish then READ that one answer, which is what ended the split where the build signed fine and `validate-certs` stopped the deploy on `Found .p12 in config/certs/ but CSC_LINK env var is not set`.

`CSC_LINK` and `APPLE_API_KEY` each take three shapes, a path, an https URL, or the file itself as inline base64, and the `validate-certs` precheck reports the non-file shapes instead of statting them ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). ON THE RUNNER the target's `config/certs/` is still the decode target: the generated `build.yml` writes the pushed base64 secrets back to disk there and points both keys at the files. It decodes each mac secret only when that secret EXISTS, and a MISSING one exits 1 naming `omega deploy` (whose precheck pushes them): a mac build `omega deploy` ships is always signed and notarized, so the leg stops instead of publishing an unsigned app. The linux and windows legs blank both keys outright, and their `validate-certs` run skips the mac rungs entirely with one line ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), because no leg but the mac one signs for mac: rungs about credentials that leg deliberately blanked are two warnings nobody can act on.

**Signing, and then the PROOF** ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)). Every rung of the mac lane fails loudly, and the last two prove their work instead of assuming it:

| Rung | What it refuses to pass |
|---|---|
| `validate-certs` (deploy precheck, and inside `publish`) | STRICT on macOS: an unset `CSC_LINK` or `APPLE_API_KEY` (which means the signing TREE holds no such file, and the line names both tier paths it looked in), a `CSC_LINK` pointing at a missing file, no `CSC_KEY_PASSWORD`, a `.p12` the password will not open, no Keychain `Developer ID Application` identity on a run whose `CSC_LINK` names no certificate (electron-builder imports a `CSC_LINK` `.p12` into its OWN temporary keychain, so the login keychain is only asked when discovery is what will sign), or an EXPIRED certificate. Under 30 days is a warning: it still signs. The unsigned findings are ERRORS only when the config declares `certificates.providers.apple`, the same gate the env schema's `requiredWhen` uses |
| `push-secrets` (the precheck step, never a verb) | A signing key the schema marks required for this brand (the mac set once `certificates.providers.apple` is declared) that the `.env` cascade resolves EMPTY stops the deploy listing every one, and publishes NOTHING: the step is `fatal` on all four frameworks. `CSC_LINK` and `APPLE_API_KEY` are DERIVED from the signing tree first, so the refusal means the artifact is missing, and its line names both tier paths plus `omega manage --service certificates` rather than a path to paste |
| `afterSign` hook ([src/hooks/notarize.js](../../packages/desktop/src/hooks/notarize.js)) | A non-darwin build is the ONE skip. Missing `APPLE_API_*` THROWS; an app whose `codesign -dv` report carries no `Developer ID Application` authority THROWS (notarytool rejects the ad-hoc signature an identity-less build leaves behind). After notarizing it runs `xcrun stapler staple`, then PROVES it with `xcrun stapler validate` and `spctl --assess --type execute -vv`, and throws unless both accept |
| `artifactBuildCompleted` hook ([src/hooks/notarize-artifacts.js](../../packages/desktop/src/hooks/notarize-artifacts.js)) | Each `.dmg`, BEFORE electron-builder uploads it (this hook is awaited before the `artifactCreated` the publisher listens on; `afterAllArtifactBuild` fires after every upload is queued, and run 34738410986 published an unstapled image from there): `xcrun notarytool submit --wait` with the same API key triple, `stapler staple`, `stapler validate`, `spctl --assess --type open --context context:primary-signature -vv`. The ticket stapled to the app INSIDE an image is not stapled to the image, and a user's Mac assesses the image first, by the image's OWN signature: the generated config sets electron-builder's `dmg.sign`, so the image carries the Developer ID signature that assessment reads (an unsigned image is refused after a clean notarize and staple) |

Both hooks run every command through one small runner (`src/hooks/lib/notarize-tools.js`) that a test replaces with a fake `xcrun`/`spctl`, and each one reads the tool's own report, stdout and stderr whatever the exit code: anything but the words that mean success throws with the tool's own verdict in the message, so the release step never runs on an artifact Gatekeeper would refuse.

All three bundles strip `@dev-only` blocks in production builds — code between `/* @dev-only:start */` and `/* @dev-only:end */` is cut from the bundle, so dev warnings and simulation hooks (@omega.js/client's and the vendored themes' included) never ship. Dev builds keep them. The markers and the cut are one home, `@omega.js/devkit/strip-dev-blocks`; desktop, web and @omega.js/extension all reach it through the same `bundle()` composition (production builds only).

### Config flow

`config/omega.json5` (JSON5, in consumer; shared sections top-level + desktop settings under `targets.desktop`) → `build.getConfig()` (resolves via `@omega.js/config`: `targets.desktop` overlays the top level, brand-monorepo walk-up included), then applies derived defaults: `app.appId` ← `<certificates.providers.apple.bundleIdPrefix>.<brand.id>` with the brand id's dashes as dots, the very id the certificates service registers ([#909](https://github.com/Omega-JS-Stack/omega/issues/909); no prefix declared, and it falls back to the reverse-domain of `brand.url`, then `app.<brand.id>`), `app.productName` ← `brand.name`) → injected into the NODE bundles (main, preload) at build time as an esbuild `define` of `OMEGA_BUILD_JSON` plus a banner that assigns the same literal to `globalThis`, and written for the RENDERER as the ONE `dist/build.js` every view's shell loads with its first script tag ([#743](https://github.com/Omega-JS-Stack/omega/issues/743), the same file and the same load order web and the extension use). Runtime reads `OMEGA_BUILD_JSON.config` first (authoritative in packaged apps); dev falls back to resolving from disk.

The wrapper is the ONE shape every OMEGA browser surface bakes ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)): `{ config, package, mode, license, builtAt }`, with the build's own facts outside `config` and never part of the client contract. What goes INSIDE `config` differs by who reads the bundle:

| Bundle | `config` |
|---|---|
| main, preload | the WHOLE resolved config, as a `define` + banner in their own bundles. The main process BOOTS from it (a packaged app's `config/omega.json5` is inside the asar), so `platforms`, `startup`, `autoUpdate`, `releases` and the rest have to be there. Both are Node, neither is a public surface |
| renderer | the browser subset, `clientConfig(resolved)` from `@omega.js/config` (the config guide's "The browser subset"), written to `dist/build.js` and loaded by the page template as `../../build.js` ahead of the view's own bundle. A renderer is a public surface: its bundle is readable from DevTools, so the GCP account facts, the signing certificates and the account admins are not in it, and the bundle itself carries no copy of the snapshot at all |

The build facts include `runtime: 'electron'` ([#896](https://github.com/Omega-JS-Stack/omega/issues/896)): a packaged renderer is a browser with no Electron globals of its own, so @omega.js/client's sniff would answer `'web'` without the baked fact. `mode` is the three keys every surface records, `{ environment, build, publish }`; desktop's own `server` verdict stays inside `build.getMode()`.

Both halves carry the same name, so `renderer.js` hands `OMEGA_BUILD_JSON.config` to `@omega.js/client` exactly as an extension page and a web page do.

Required fields: `brand.id` + `brand.name`. Everything else has defaults. See [docs/installer-options.md](../../packages/desktop/docs/installer-options.md) for the full defaults table.

### Schema validation

Every field in `config/omega.json5` is declared in `@omega.js/config`: the shared OMEGA schema plus the desktop refinements (`TARGET_SCHEMAS.desktop`), vendored into `dist/vendor/config/` and exposed to consumers as `require('@omega.js/desktop/config')`. Runs at boot (hard-fails `omega.initialize()` if invalid) AND in `gulp/audit` (plus build-pipeline extras). The audit reports the validator's WARNINGS too ([#911](https://github.com/Omega-JS-Stack/omega/issues/911)): `omega build` prints each one and counts it (`audit ok (1 warning)`), so a key the schema does not declare, which is exactly what a typo looks like, is seen at build time instead of dropped. See [docs/config-schema.md](../../packages/desktop/docs/config-schema.md).

### Cross-context helpers

The three process instances (main / preload / renderer) carry the shared helpers as methods, and the build module (`require('@omega.js/desktop/build')`) exports the environment four and `getVersion()` as plain functions: `isDevelopment()`, `isProduction()`, `isTesting()`, `getWebsiteUrl()`, `getEnvironment()`, `getFunctionsUrl()`, `getApiUrl()`, `getAuthUrl()` (the sign-in URL that round-trips an auth token back into the app via the `auth/token` deep link; never link the bare `/signin` page; apps launch it via **`omega.openAuthFlow()`** (main), which opens the user's REAL default browser and, in dev/test where the custom scheme isn't OS-registered, swaps the final hop for a one-shot nonce-checked loopback listener (RFC 8252) feeding the same deep-link pipeline, `lib/auth-flow.js`). Use these instead of grepping `process.env` ad-hoc. `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive), and the three `is*()` checks DERIVE from it; gate side effects on the INTENTIONAL check (`isProduction()` for prod-only, `isDevelopment() || isTesting()` for local-or-test); never `!isDevelopment()`.

**The environment four are `@omega.js/config`'s ONE module** ([#817](https://github.com/Omega-JS-Stack/omega/issues/817), the contract in full: [docs/shared/config.md](../shared/config.md)): `src/utils/mode-helpers.js` re-exports them beside desktop's own `getVersion()`, so all four frameworks hang the identical functions. They read ONE input and never guess: `OMEGA_ENVIRONMENT` in Node, and the baked `OMEGA_BUILD_JSON.config.environment` in a renderer (which has none). Nothing sniffs `app.isPackaged` or `NODE_ENV` any more, and a context with neither input throws by name rather than defaulting; the old default here was `production`, so a plain `npm start` bundled itself as a production artifact while @omega.js/extension's copy of the same function answered `development`. `src/build.js` names the input at load, from the lane (`OMEGA_BUILD_MODE` is production and wins over an inherited value; the test runners name `testing`; a bare dev boot is `development`), and `main.js` names it from the baked config for a packaged app that has no parent lane: a FALLBACK for the context with no input, never an override of a lane that named one ([#925](https://github.com/Omega-JS-Stack/omega/issues/925)). A renderer has no `process` either, so the preload hands it the running word on `window.desktop.environment` and the renderer bootstrap applies it over the bake, which is how a test lane booting a production artifact answers `testing` in every context of that app. See [docs/environment-detection.md](../../packages/desktop/docs/environment-detection.md).

### Test framework

`npx omega test` discovers + runs framework suites (`<@omega.js/desktop>/dist/test/suites/**`) plus consumer suites (`<cwd>/test/**`). Four layers: **build** (plain Node), **main** (spawned Electron), **renderer** (hidden BrowserWindow), **boot** (consumer's actual built bundle for end-to-end smoke tests). The worked CONSUMER example is the playground desktop target's [`test/`](../../brands/playground-omega/targets/desktop/test) ([#811](https://github.com/Omega-JS-Stack/omega/issues/811)): a build suite over its resolved config and a boot suite over its real bundle, each asserting only what that project declares or wires. A renderer suite reaches the project's OWN views by declaring `view: '<name>'`, which runs it on the boot lane's built app so the page carries the project's real preload, IPC handlers and config ([#813](https://github.com/Omega-JS-Stack/omega/issues/813)). A test run never touches the OS keychain (auth persistence is `none` on every layer, whatever the brand declares) and a boot that produces no harness output inside the budget fails with the last `runtime.log` line instead of hanging the runner ([#907](https://github.com/Omega-JS-Stack/omega/issues/907)). See [docs/test-framework.md](../../packages/desktop/docs/test-framework.md), [docs/test-boot-layer.md](../../packages/desktop/docs/test-boot-layer.md).

### Test coverage

Every feature ships with tests at EVERY layer it has a surface in — logic (`build`/`main`), UI (`renderer` — real events on the real DOM), and end-to-end (`boot`). Skip a layer ONLY when the feature genuinely has no surface there (a pure build utility has no UI; a CSS-only tweak has no logic). "The logic test already covers it" is NOT a reason to skip the UI test — logic tests prove the logic, UI tests prove the wiring, boot tests prove the built artifact. See [docs/test-framework.md](../../packages/desktop/docs/test-framework.md).

### Dev logs

Every gulp invocation tees stdout+stderr to `<projectRoot>/logs/dev.log` on `npm start` or `logs/build.log` on a production build/package (`OMEGA_BUILD_MODE=true`), chosen by build mode, path via `OMEGA_LOG_FILE`; disable with `OMEGA_LOG_FILE=false`. `npx omega test` likewise tees its output to `<projectRoot>/logs/test.log`, and `omega deploy` (with `npm run release`, the dispatch it delegates to) streams the GH Actions run to `logs/deploy.log`. The packaged app's own `logs/runtime.log` (main + preload + renderer) sits beside them, and Windows signing appends `logs/signing.log`. When debugging via Claude, prefer `cat logs/dev.log` / `cat logs/test.log` over copy-pasting terminal scrollback; never restart the app to see output it already wrote. The runtime logger: [docs/logging.md](../../packages/desktop/docs/logging.md); the cross-framework tee contract and the full path table: [docs/shared/logging.md](../shared/logging.md).

### CDP debugging (Claude ↔ Electron)

`serve` forwards all `--` CLI flags to the Electron child process. Set `OMEGA_CDP_PORT=9222` (or pass `--remote-debugging-port=9222` via `--`) to expose Chrome DevTools Protocol on that port. Drive the running app with the built-in toolkit — `npx omega cdp status|eval|shot|capture|theme|relaunch|quit` (multi-target by URL substring; `relaunch` IS the dev iterate loop since serve has no watch) — or via the `chrome-devtools-electron` MCP upstream for richer single-page interaction (click, fill, network, traces). See [docs/cdp-debugging.md](../../packages/desktop/docs/cdp-debugging.md).

## CLI

`npx omega <command>` (bare `omega` prints the listing). Every verb runs `ensureTarget()` first — the local scaffold the retired `omega setup` used to own ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): scripts, `.nvmrc` seed, Node check, peer deps, the defaults tree, the locality warning. It writes no `.env` ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)): the brand root's `.env` is the one file humans and the manager edit, and a target `.env` is an optional per-key override you author yourself. The scripts it syncs spell the verb BARE (`omega build`, never `npx omega`) — npm already puts `node_modules/.bin` on the path inside a script; the `npx` form stays canonical for docs and the terminal ([#748](https://github.com/Omega-JS-Stack/omega/issues/748)). The gulp verbs get it from the `defaults` task; `test` and `deploy` call it themselves:

| Command | Description |
|---|---|
| `clean` | remove `dist/`, `release/`, `.cache/` |
| `install` | install peer deps |
| `version` | print versions |
| `test` | run the project's test suites (`framework:` / `full:` reach the framework suite) |
| `update` | dependency freshness report (installed/wanted/latest + patch/minor/major, < 7-day releases QUARANTINED); `--apply` installs the safe set via npu, `--major` explicit. Aliases: `outdated`, `out`. See docs/shared/updates.md in the Omega repo |
| `deploy` | the deliberate-deploy verb (see docs/shared/deploys.md in the Omega repo): dispatch the composed `build.yml`, or with `--direct` run `omega publish --local` right here for the HOST platform, pinned by test to CI's own `release:local` step ([#865](https://github.com/Omega-JS-Stack/omega/issues/865)). A `--platforms` value the host cannot build refuses under `--direct`, because a cross-platform build is CI-only ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). A DISPATCH runs the NETWORK prechecks first: framework freshness, `validate-certs`, repo provisioning, the secrets push, the two SIGNING ones fatal ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)); `--no-secrets` skips them all, and `--direct` never reaches them (a local deploy publishes no signing certs to the repo, #872). `--dry-run` RUNS the precheck too and sends nothing: the plan names the secret keys it would publish ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)). |
| `logs [runtime|dev|build|test]` | read one of the project's log files, `runtime` by default (alias `log`) |
| `help` | command listing (router built-in; also `-h`/`--help`) |
| `build` | clean + `gulp build`, with `OMEGA_BUILD_MODE=true` set in-process |
| `package` | clean + the electron-builder package (`--quick` for host platform/arch only) |
| `publish` | ship-credential check + `validate-certs` (strict) + full sign + notarize + GH release upload (`OMEGA_IS_PUBLISH=true`); `--local` cleans first |
| `validate-certs` | check the derived signing env, the cert file and its expiry, the notarization key, the Keychain identity. The mac rungs run on the mac leg only (#891). Auto-runs as an `omega deploy` precheck |
| `sign-windows` | strategy-aware EV/cloud/local signer; emits JSONL events for `runner monitor` |
| `runner monitor` | tails `omega-signing.log` and pretty-prints signing events |
| `launch` | launch a packaged app with clean env (strips `ELECTRON_RUN_AS_NODE`); auto-discovers `release/<platform>-<arch>/<App>.app`. Aliases: `mgr open` |
| `finalize-release` | `--signed-dir` uploads signed installers; `--publish` flips release Draft→Published |
| `release` | trigger consumer's GH Actions Build & Release workflow, poll-stream logs |

See [docs/releasing.md](../../packages/desktop/docs/releasing.md) for the end-to-end flow.

**A publish refuses a declared format it has no credential for, before it builds** ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)). `omega publish` (which CI runs too, as `npm run release:local`) opens with a `ship-keys` step: the brand's declaration says what ships, @omega.js/config's format table says what each format needs, and anything empty stops the verb in a second instead of after a build. The wording is the extension publish's, to the letter (both read devkit's `ship-plan`): the key, the declaration that requires it (`platforms.linux.formats.snap`), and the ONE walk that collects it, `omega manage --service publishing`. What is OWED is gated by the brand's own config, so a brand that never mentions the snap is never refused for `SNAPCRAFT_STORE_CREDENTIALS`, and the Windows set narrows to the configured `platforms.windows.signing.strategy`. A BUILD keeps its clean skip (`build-config` drops the snap target when the login is absent): a build puts nothing in front of users. Every `asset` format rides the releases repo; the snap is the one desktop `store` format, and the Snap Store registers its name with the same credentials that publish, so desktop has no listing id to collect and no manual step to print.

**The release verbs read the repo from CONFIG** ([#799](https://github.com/Omega-JS-Stack/omega/issues/799), [#883](https://github.com/Omega-JS-Stack/omega/issues/883)): `release` and `deploy` dispatch on the brand's SOURCE repo (`@omega.js/config`'s `sourceRepo`: `<brand.id>-omega` under `repo.org`), and `finalize-release`, the deploy precheck's provisioning and the electron-builder publish block all address the brand's ONE public releases repo (`releasesRepo`: always `<brand.id>-releases` under that same org, since `targets.desktop.releases.owner/repo` are retired and `releases: {}` is a presence switch alone). The precheck creates it public, with a first commit, through the ONE repo helper every OMEGA lane uses (`@omega.js/devkit/github-repo`'s `ensureRepo`). No git remote is read anywhere, so a target inside a brand monorepo stops targeting the repo it is nested in. The dispatched workflow is the one the scaffold wrote: `desktop-build.yml` at the brand root, `build.yml` standalone, named by the same `@omega.js/devkit/ci-workflows` helper web and the extension use. The `downloads:` mirror lane retired with it.

**`finalize-release` finds the release by LISTING, drafts included** ([#810](https://github.com/Omega-JS-Stack/omega/issues/810)): a draft carries no tag ref, so `repos.getReleaseByTag` answers with PUBLISHED releases only and 404'd on the very draft electron-builder had just created. Every run then made another draft for the same version (two v0.0.1 drafts on the playground's releases repo), and a full run would have split its assets across two of them while the `--publish` flip found neither. Both call sites (the signed-Windows upload and the flip) now read through one `findRelease` helper that paginates `repos.listReleases` and matches `tag_name`: the newest draft wins, since that is the one this run's publish step created; a published release answers when no draft carries the tag; and only a tag with neither leaves the upload step creating the draft a partial-platform run needs. Uploading an asset whose name is already on the release deletes the old one first, with one line naming the replacement, so re-running a version never collides.

**The release workflow runs no tests** ([#802](https://github.com/Omega-JS-Stack/omega/issues/802)): it is dispatch-only and builds, like web's and the extension's. The suites run on the developer's machine and the commit gate runs the battery at ship ([docs/shared/testing.md](../shared/testing.md)), so the Test job the workflow used to carry is gone: `build` needs `setup`, and `finalize`, the job that flips the draft release to published, needs `[setup, build, windows-sign]` and gates on `needs.build.result == 'success'` inside its `always()`.

## Dependency Resolution

- **Consumer code can `require()` any @omega.js/desktop dependency** — the bundler re-resolves every name @omega.js/desktop DECLARES from the framework's own installation (`@omega.js/devkit/bundle`'s framework-deps hook). Consumer projects do NOT need to `npm install firebase`, `fs-jetpack`, `@omega.js/client`, or any other @omega.js/desktop dep. If a dep doesn't resolve, the fix is in @omega.js/desktop's `package.json` or its bundle task — not the consumer's `package.json`.
- **The framework's copy wins ([#87](https://github.com/Omega-JS-Stack/omega/issues/87)).** Every name @omega.js/desktop DECLARES is re-resolved from the framework root by `@omega.js/devkit/bundle`'s resolve hook, so a consumer that declares its own version of a framework dependency still bundles ONE copy — the framework's — the identical hook and guarantee @omega.js/web gives web consumers. npm nests a framework-private copy only when the consumer's declaration conflicts, so this picks the nested copy on a conflict and the shared hoisted copy otherwise. There is no per-dependency override today, so a consumer that genuinely needs its OWN copy of a framework-carried package should raise it upstream ([#87](https://github.com/Omega-JS-Stack/omega/issues/87)) rather than pin and silently lose. Narrower than the webpack `resolve.modules` ordering it replaced ([#737](https://github.com/Omega-JS-Stack/omega/issues/737)): a package the framework only carries TRANSITIVELY is no longer forced to the framework's copy, because the hook reads the declared set. @omega.js/extension is on the same hook since [#738](https://github.com/Omega-JS-Stack/omega/issues/738); pinned by `src/test/suites/build/framework-deps.test.js` in each.
- **@omega.js/client owns Firebase.** Consumer code NEVER imports Firebase directly (`require('firebase')` / `import('firebase/app')`). In renderers use `omega.auth` and `omega.firestore` on the renderer instance. In the main process, use `omega.auth` (the @omega.js/desktop bridge). Same rule on every OMEGA browser surface.
- **`omega.require(name)`** (main) resolves from @omega.js/desktop's module context at runtime. Use in gulp tasks or unbundled code (e.g. test fixtures). The bundle task's framework-deps hook handles the bundled case.

## Development Workflow

- **🚫 NEVER use `npx omega ...` from the framework repo**: `npx omega` is for CONSUMER projects only (where the bin lives in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. The `scripts` in `package.json` call `node bin/omega` directly. This applies to ALL four OMEGA frameworks (@omega.js/backend, UJM, @omega.js/extension, @omega.js/desktop).
- **🚫 NEVER run `npm start`** (consumer projects) — it's the user's long-running dev process. Assume it's already running; if it isn't, **instruct the user to run it** rather than running it yourself (running it again kills theirs). To see output, **read the `logs/*.log` files** (`dev.log`, `runtime.log`, `test.log`) — never tail/attach to the process. Running `npx omega test` is fine.
- **After editing files**, verify the gulp watcher recompiled successfully. Check for esbuild/sass errors in the console output. A change that breaks the build is not a completed change.
- **Live-test UI changes via CDP.** After code changes compile, use the `chrome-devtools-electron` MCP tools (screenshots, click, evaluate JS, console logs) to verify the change works in the running app. This is the primary way to confirm UI/renderer changes — type-checking and test suites verify code correctness, not feature correctness. See [docs/cdp-debugging.md](../../packages/desktop/docs/cdp-debugging.md) and `~/.claude/mcp-server/servers/chrome-devtools-electron/CLAUDE.md`.

## Supply-Chain Security

All `npm install` calls in CLI commands (`npx omega i`, `npx omega runner`, the peer-dependency step of every verb's `ensureTarget()`) route through the `safeInstall()` helper (`src/utils/safe-install.js`). It prefixes `sfw` (Socket Firewall) when installed — blocking confirmed malware at the network level before packages reach disk. Falls back to plain npm if sfw isn't available. CI workflows get the firewall from Socket's own GitHub Action (`SocketDev/action`, firewall mode, pinned; it downloads the binary with the job's token and caches it, so a hosted runner's shared anonymous API quota never fails the step, [#871](https://github.com/Omega-JS-Stack/omega/issues/871)) and run `sfw npm ci`. The template carries only the `{{ installFirewall }}` token; the composer renders the step, once, from devkit's one pinned constant ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). It renders a Windows shim beside it, because the windows legs of the build force `shell: cmd` and cmd cannot execute the extension-less `sfw` the action caches ([docs/shared/deploys.md](../shared/deploys.md)). Installs will **fail if sfw detects confirmed malware** in any package in the dependency tree; non-critical CVEs and quality warnings pass through.

## File Conventions

- **CommonJS** (`require()`) throughout. Node 24 runs ESM deps natively via `require()` — no need for dynamic `import()` unless a package is genuinely ESM-only. For ESM-only deps in bundled code, use a STATIC-specifier `await import('pkg')` — esbuild inlines the module into the consumer's bundle so packaged apps need nothing installed (e.g. `electron-store@11` in `lib/storage.js`). NEVER make a dep import unbundlable (a variable specifier, or an ignore comment): it leaves a runtime resolution that fails in packaged consumers (@omega.js/desktop is a devDependency — it never ships in the asar).
- **Node version auto-synced from Electron.** The consumer's `postinstall` (`scripts/sync-nvmrc.js`) queries `releases.electronjs.org` and writes `.nvmrc` to match — the ONE reader of that feed. `ensureTarget()` only SEEDS `.nvmrc` from the framework's pinned `omega.nodeRuntime` when the file is missing, so the two never fight, and warns when the running Node major is not the pin.
- One `module.exports = ...` per file.
- Logical operators at the **start** of continuation lines.
- Short-circuit early returns rather than nested ifs.
- Prefer **`fs-jetpack`** over `fs-extra`.
- **No backwards compatibility** unless explicitly requested — this is unreleased v1.
- **Lib structure — flat file vs directory split.** Default to flat `src/lib/<name>.js`. Split into a directory (`src/lib/<name>/{index,core,main,renderer,preload}.js`) ONLY when each Electron context has materially different logic. No lib is split today — `lib/sentry/` was the one, and it moved WHOLE into `@omega.js/monitoring` (#380) once the backend and the client needed the same policy. Don't split prophylactically.
- **Use `app.getAppPath()`, not `process.cwd()`, for runtime path resolution.** In a packaged app, `process.cwd()` is `/`. Use `require('./utils/app-root.js')()` — tries `app.getAppPath()` first, falls back to `process.cwd()` for tests/non-Electron contexts.
- **Zero-trust URL handling — `sanitizeURL` for `shell.openExternal` and friends.** Any dynamic URL passed to `shell.openExternal`, `BrowserWindow.loadURL`, `window.location.href =`, etc. MUST be gated through `require('./utils/sanitize-url.js')` first. Returns the URL unchanged when its protocol is `http:`/`https:`, and `''` for anything else (`javascript:`, `data:`, `file:`, `vbscript:`, `chrome:`, custom schemes). Canonical pattern: `const safe = sanitizeURL(url); if (safe) shell.openExternal(safe);`. Hardcoded URLs constructed entirely from internal constants (e.g. the restart-manager feed URLs built from schema-validated config in `lib/restart-manager/install.js`) bypass — not attacker-controllable. See `src/utils/sanitize-url.js` and the `js:patterns/xss-escaping` skill.
- **`ELECTRON_RUN_AS_NODE` is stripped at the CLI boundary.** When set, Electron silently runs as plain Node: `app` is undefined, no BrowserWindow. The variable leaks from common parent processes (VS Code's Claude Code extension runs as a `node.mojom.NodeService` utility process with the var set). `src/cli-run.js` (the bin body every `bin/omega` invocation and every cross-framework dispatch runs) and `src/gulp/main.js` both `delete process.env.ELECTRON_RUN_AS_NODE` at the top.

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`docs/desktop/index.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

**The four framework guides are structurally MIRRORED.** [docs/web/index.md](../web/index.md), [docs/backend/index.md](../backend/index.md), [docs/desktop/index.md](../desktop/index.md), and [docs/extension/index.md](../extension/index.md) keep the same section skeleton in the same order, and each consumer template (`src/defaults/AGENTS.md`; web's lives at `scaffold/AGENTS.md`) mirrors its guide. Never add, rename, or reorder a section in one without making the SAME change in the others in the same pass.

## Documentation

API references for each subsystem live in `docs/`. **Whenever you make a behavioral change, update both this overview AND the relevant `docs/*.md` deep reference.** Treat docs as a first-class deliverable, not an afterthought.

- [docs/boot-sequence.md](../../packages/desktop/docs/boot-sequence.md): full `omega.initialize()` ordered list + rationale
- [docs/lib-modules.md](../../packages/desktop/docs/lib-modules.md) — lib initialization contract, adding a new lib, flat-vs-split convention
- [docs/storage.md](../../packages/desktop/docs/storage.md) — main + renderer storage, dot-notation, change broadcasts
- [docs/ipc.md](../../packages/desktop/docs/ipc.md) — typed channel bus
- [docs/windows.md](../../packages/desktop/docs/windows.md) — named windows, bounds persistence, hide-on-close, inset titlebar
- [docs/tray.md](../../packages/desktop/docs/tray.md) — file-based tray
- [docs/menu.md](../../packages/desktop/docs/menu.md) — file-based application menu
- [docs/context-menu.md](../../packages/desktop/docs/context-menu.md) — file-based right-click menus
- [docs/startup.md](../../packages/desktop/docs/startup.md) — launch modes, zero-bounce production
- [docs/app-state.md](../../packages/desktop/docs/app-state.md) — launch flags, crash sentinel
- [docs/deep-link.md](../../packages/desktop/docs/deep-link.md) — cross-platform deep links, single-instance, built-in routes
- [docs/auth.md](../../packages/desktop/docs/auth.md): `omega.auth`, Firebase auth state sync across main + renderers, session persistence (safeStorage vault), the renderer @omega.js/client auth cycle (`data-omega-bind` bindings live in every renderer) + the account push that builds main's `omega.auth.user`
- [docs/auto-updater.md](../../packages/desktop/docs/auto-updater.md) — startup + periodic checks, 30-day pending-update gate, idle-aware install
- [docs/analytics.md](../../packages/desktop/docs/analytics.md) — GA4 Measurement Protocol, cross-platform `uuidv5` identity
- [docs/context.md](../../packages/desktop/docs/context.md) — runtime context block (geolocation, client, session, app)
- [docs/usage.md](../../packages/desktop/docs/usage.md) — opens / hoursTotal / hoursThisSession; clean-exit accumulation
- [docs/remote-config.md](../../packages/desktop/docs/remote-config.md) — "hot config" fetched from brand site
- [docs/remote-scripts.md](../../packages/desktop/docs/remote-scripts.md) — emergency remote code execution (opt-in, https-only), content-hash dedup
- [docs/restart-manager.md](../../packages/desktop/docs/restart-manager.md) — the external guardian app: HTTP protocol v1 (SSOT), silent install, self-updates via its own @omega.js/desktop autoUpdater, threat model
- [docs/config-schema.md](../../packages/desktop/docs/config-schema.md) — canonical schema + validator
- [docs/sentry.md](../../packages/desktop/docs/sentry.md) — the desktop half of `@omega.js/monitoring`, auto auth attribution
- [docs/templating.md](../../packages/desktop/docs/templating.md) — `{{ }}` token replacement, page vars, HTML pipeline
- [docs/logging.md](../../packages/desktop/docs/logging.md) — runtime logger (main + preload + renderer → one `runtime.log`)
- [docs/themes.md](../../packages/desktop/docs/themes.md): vendored classy + bootstrap themes, per-page CSS bundles, system-aware appearance (`omega.theme`)
- [docs/tooltips.md](../../packages/desktop/docs/tooltips.md) — Bootstrap JS ships in @omega.js/desktop (prebuilt bundle, Popper inlined): zero-setup auto-initialized tooltips, `window.bootstrap` namespace
- [docs/css.md](../../packages/desktop/docs/css.md) — SCSS architecture: main entry, theme `@use` config, per-window bundles, Bootstrap-first
- [docs/hooks.md](../../packages/desktop/docs/hooks.md): lifecycle hooks (build/pre, build/post, release/pre, release/post, notarize/post, deploy/pre)
- [docs/shared/icons.md](../../packages/desktop/docs/icons.md) — convention-only icon resolution (`global/` + per-platform), retina derivation, macOS Template magic
- [docs/fontawesome.md](../../packages/desktop/docs/fontawesome.md): Font Awesome Free served from the npm dep (icon semantics shared with web via @omega.js/client's icon-core): `<i class="fa-solid fa-*">` auto-render, `omega.desktop.fontawesome.get`
- [docs/verts.md](../../packages/desktop/docs/verts.md) — `[data-omega-vert]` auto-bind to @omega.js/client's verts module (live via MutationObserver): house/company lane ONLY (type pinned 'house' — no AdSense in desktop surfaces)
- [docs/installer-options.md](../../packages/desktop/docs/installer-options.md) — per-target installer config, defaults table
- [docs/signing.md](../../packages/desktop/docs/signing.md) — code signing for macOS + Windows
- [docs/releasing.md](../../packages/desktop/docs/releasing.md) — end-to-end release walkthrough
- [docs/runner.md](../../packages/desktop/docs/runner.md): Windows EV-token signing runner. The listener runs with a private HOME (`%LOCALAPPDATA%\omega-runner\home`, holding a real `.gitconfig`), written at install and healed by `start`/`restart`, so a job's `actions/checkout` never copies the box's symlinked `~/.gitconfig` into a junction it cannot read ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)). The same install writes the box's JOB GUARD ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): a job-started hook beside the runner, pointed at through each registration's `ACTIONS_RUNNER_HOOK_JOB_STARTED`, that fails any job whose event is not a dispatch or whose repository or actor is not on the box's own allow lists. `start` is the one command a box operator runs ([#937](https://github.com/Omega-JS-Stack/omega/issues/937)): it installs a bare box, refreshes a stale actions/runner download in place, and registers any admin org the box does not serve yet before bringing every org online
- [docs/test-framework.md](../../packages/desktop/docs/test-framework.md) — writing tests, running them, layers
- [docs/test-boot-layer.md](../../packages/desktop/docs/test-boot-layer.md) — the `boot` test layer: consumer end-to-end smoke + @omega.js/desktop's framework self-test from the repo via the bundled fixture (`src/test/fixtures/consumer-app/`) + `OMEGA_TEST_BOOT_PROJECT` (@omega.js/desktop's analog of @omega.js/backend/BXM/UJM `*_TEST_BOOT_PROJECT`)
- [docs/build-system.md](../../packages/desktop/docs/build-system.md) — gulp, esbuild, electron-builder pipeline
- [docs/environment-detection.md](../../packages/desktop/docs/environment-detection.md) — `isDevelopment`/`isTesting`/`getApiUrl` etc., adding new helpers
- [docs/common-mistakes.md](../../packages/desktop/docs/common-mistakes.md) — the canonical "don't do this" list
- [docs/audit.md](../../packages/desktop/docs/audit.md) — full-audit check catalog (U-xx universal / DSK-xx / F-xx IDs with severity + scope), protocol + fix loop
- [docs/cdp-debugging.md](../../packages/desktop/docs/cdp-debugging.md) — Claude ↔ Electron via CDP: the `mgr cdp` toolkit (status/eval/shot/capture/theme/relaunch/quit), `OMEGA_CDP_PORT`, MCP setup

`PROGRESS.md` tracks pass-by-pass progress and decisions.
