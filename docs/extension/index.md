# OMEGA Extension (@omega.js/extension)

> **Note for contributors and Claude:** This file is the guide for `@omega.js/extension` — identity, top-level conventions, and a map to the deep references. It lives in the monorepo's `docs/` tree and is loaded on demand (the omega Claude plugin's hooks inject it by context; the repo-root AGENTS.md map is the one agent entry — packages carry no agent docs). The **meat** (per-subsystem APIs, edge cases, behavior tables, defaults lists) lives in the package's own [`docs/<topic>.md`](../../packages/extension/docs) files. When extending or adding content, write it in the matching `docs/*.md` file and cross-link from here — do NOT inline it. If a topic doesn't have a doc yet, create one.

> **Mirrored structure:** the four framework guides — `docs/web/index.md`, `docs/backend/index.md`, `docs/extension/index.md`, and `docs/desktop/index.md` — mirror each other (the legacy UJM/BEM/BXM/EM lineage): shared sections (Supply-Chain Security, Development Workflow, File Conventions, Doc-update parity, etc.) appear in the **same order at the same position** across all four. When adding a section that applies to multiple frameworks, insert it in the same spot in all of them.

## Identity

OMEGA Extension (@omega.js/extension) is a comprehensive framework for building modern cross-browser extensions (Chrome, Firefox, Edge, Opera, Brave). Sister project to @omega.js/desktop and Ultimate Jekyll Manager (UJM). Provides one-line-import bootstrap per extension context, a component-based architecture, a multi-browser build/release pipeline, config-driven auto-translation (`translation.languages`), cross-context auth synchronization, and a built-in four-layer test framework.

## Recommended skills

- **`omega:extension`** — the router skill from the omega Claude plugin. The inject hook loads it automatically in any project with `@omega.js/extension` (and inside `packages/extension` here); it points back to this guide + `docs/` (the SSOT).
- **`js:patterns`** — JavaScript/Node.js conventions: file structure, JSDoc, defensive coding (`?.` usage), template literals, `package.json` conventions. Auto-loads when creating new `.js` files or touching JS module structure.

## 🚨 READ @omega.js/client TOO

**@omega.js/extension ships `@omega.js/client` as a runtime singleton across every extension context** (background service worker, popup, options, sidepanel, content scripts) — it powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.). Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with @omega.js/extension.

**Required reading:**
- **`docs/client/index.md`** (in the framework monorepo) — the client guide: identity, module list, conventions
- **`node_modules/@omega.js/client/docs/`** — module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick Start

### For Consuming Projects

1. `npm install @omega.js/extension --save-dev`
2. There is no setup step ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)). The project scaffolds itself on the first verb below — `ensureTarget()` copies `src/defaults/` into the project (`src/manifest.json`, `src/views/`, `src/assets/`, `config/omega.json5`, etc.), syncs the project scripts, and checks Node + peer deps, idempotently and silently once the target is converged.
3. `npm start` — dev (gulp → esbuild → serve with live reload)
4. `npm run build` — production build (compiles `dist/`, packages per-browser into `packaged/<browser>/raw/` + `.zip`); the script is a thin alias of `npx omega build`, the verb that owns the pipeline
5. `OMEGA_IS_PUBLISH=true npm run build` — also uploads to Chrome / Firefox / Edge stores (see [docs/shared/publishing.md](../../packages/extension/docs/publishing.md))
6. `npx omega test` — runs the project's test suites (bare consumer runs never include the framework corpus)
   - `npx omega test build/config` — bare path: run project tests matching a path
   - `npx omega test framework:` / `npx omega test full:` — reach the framework suite (alone, or both sources)
   - `npx omega test mgr:` — run ONLY framework tests (`mgr:` is the universal cross-framework alias; `extension:` / `framework:` are equivalent)
   - `npx omega test extension:build/config` — run only framework tests matching a path
   - The positional target selects which test FILES run (by source + path); `--filter=<substring>` is orthogonal — it matches test NAMES within them
   - Output is teed (ANSI-stripped) to `<projectRoot>/logs/test.log`, truncated fresh each run — `cat logs/test.log` instead of scrolling scrollback
   - Extended mode (off by default): `npx omega test --extended` or `TEST_EXTENDED_MODE=true npx omega test` opts into tests that hit REAL external services (Firebase via @omega.js/client, push, network). `TEST_EXTENDED_MODE` is the shared, unprefixed name across all OMEGA frameworks; it propagates to every spawned test environment

To load the unpacked extension in Chrome: point chrome://extensions → "Load unpacked" at `packaged/chrome/raw/`.

### For Framework Development (This Repository)

> **🚫 NEVER use `npx omega ...` from the framework repo.** `npx omega` is for CONSUMER projects only (where the bin is linked in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. — the `scripts` in `package.json` call the local `bin/` directly. This applies to ALL four OMEGA frameworks.

1. `npm install`
2. `npm start` — watch + compile `src/` → `dist/` via prepare-package
3. Test in the **designated test consumer** — `../../ITW-Creative-Works/powertools-browser-extension` is @omega.js/extension's consumer for validating framework changes end-to-end (exercise any consumer-level flow there freely: builds, tests, packaging, runtime). From inside it, run `npx omega install dev` to swap @omega.js/extension to this local repo — required whenever you edit the framework source and want the consumer to pick up the changes (the consumer otherwise keeps its installed `node_modules/@omega.js/extension`). Reverse with `npx omega install live`.
4. `npm test` — runs the framework's own suites

## Architecture

### Per-context Manager singletons

Each extension context has its own one-line bootstrap. Eight contexts total — see [docs/managers.md](../../packages/extension/docs/managers.md):

```js
// src/assets/js/components/popup/index.js
import Manager from '@omega.js/extension/popup';
await new Manager().initialize();

// src/assets/js/components/background.js  (service worker)
import Manager from '@omega.js/extension/background';
await new Manager().initialize();

// Same shape for options / sidepanel / content / page / offscreen
```

After `initialize()`, the Manager exposes:
- `manager.extension` — cross-browser `chrome.*` / `browser.*` API wrapper ([docs/extension.md](../../packages/extension/docs/extension.md))
- `manager.logger` — per-context logger stamping the ONE identity tag, `[@omega.js/extension:<context>]`, with NO timestamp (devtools stamps runtime lines; only the build-time devkit logger prefixes `[HH:MM:SS]`) — [#12](https://github.com/Omega-JS-Stack/omega/issues/12)
- `manager.omega` — Web Manager singleton (Firebase, auth, analytics, reactive bindings)
- `manager.messenger` — `chrome.runtime.onMessage` listener wired automatically
- `manager.isDevelopment() / isProduction() / isTesting() / getVersion()` — cross-context helpers ([docs/environment-detection.md](../../packages/extension/docs/environment-detection.md))

### Component architecture

Extensions are organized around **components** — each a browser-extension context bundling a view, styles, and a script. Seven contexts × three parts each:

| Component | Runs in | When |
|---|---|---|
| `background` | MV3 service worker | Always — source of truth for auth + messaging |
| `popup` | Browser-action popup | When the user clicks the toolbar button |
| `options` | Standalone tab | When the user opens settings |
| `sidepanel` | Chrome side panel (114+) | When the user opens the side panel |
| `content` | Each visited web page | Injected by manifest `content_scripts` |
| `pages` | Custom extension page (dashboard, welcome) | Routed via `chrome.tabs.create` |
| `offscreen` | Offscreen document (Chrome 109+) | For WebSocket, DOM parsing, long-running SW-adjacent tasks |

Each component has three parts at conventional paths:
- View: `src/views/<component>/index.html`
- Styles: `src/assets/css/components/<component>/index.scss`
- Script: `src/assets/js/components/<component>/index.js`

Compiled output: `dist/views/<component>/index.html`, `dist/assets/css/components/<component>.bundle.css`, `dist/assets/js/components/<component>.bundle.js`. See [docs/components.md](../../packages/extension/docs/components.md).

### Cross-context auth sync

Background.js is the source of truth for authentication. Other contexts compare their UID with background's on load and sync up — sign-ins / sign-outs broadcast across all open contexts via `chrome.runtime` messaging. No `chrome.storage` involved; Firebase persists per-context sessions in IndexedDB.

Three flows: sign-in (website `/token` redirect → broadcast), context-load (`omega:syncAuth`), sign-out (`omega:signOut` broadcast). Auth-button CSS classes (`.omega-signin`, `.omega-signout`, `.omega-account`) wire UI without writing JS — they are click triggers on @omega.js/client's shared registry ([client guide](../client/index.md#click-triggers-modulestriggersjs)), with the extension registering `omega-signin` and `omega-account` itself. @omega.js/client reactive bindings (`data-omega-bind="@show auth.user"`) handle DOM state.

Required setup: `brand.url` in config (background.js watches that host for the /token redirect), `tabs` permission in manifest. See [docs/auth.md](../../packages/extension/docs/auth.md).

### Build system

`src/` (consumer) → `dist/` (intermediate, JSON5 manifest) → `packaged/<browser>/raw/` (strict-JSON manifest, Chrome-loadable) → `packaged/<browser>/<name>.zip` (store upload). There are TWO builds, `chrome` and `firefox` ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)): `edge` publishes the chrome artifact, and every other Chromium browser installs it. What the extension SHIPS is one declaration, `platforms.<chrome|firefox|edge>.formats.<zip|store>`, the SAME shape the desktop target carries: presence = enabled, both formats default on, `false` drops one.

- **Gulp** auto-loads tasks from `src/gulp/tasks/` via `src/gulp/main.js`. Tasks: `defaults`, `distribute`, `sass`, `bundle`, `html`, `icons`, `translate`, `package`, `serve`, `audit`.
- **esbuild** — bundles each `src/assets/js/components/<name>/index.js` to `dist/assets/js/components/<name>.bundle.js`. The bundler is @omega.js/devkit's ONE `bundle()` wrapper since [#738](https://github.com/Omega-JS-Stack/omega/issues/738) — webpack, babel-loader and `@babel/preset-env` are gone, and the task went with the name: `src/gulp/tasks/bundle.js`, gulp task `bundle`, log tag `[@omega.js/extension:bundle]`. ONE call covers every lane (`iife`, no code splitting anywhere, which is what MV3's CSP requires of a service worker and a content script alike), and esbuild's `target` IS the syntax floor, READ from the manifest (`minimum_chrome_version`, `browser_specific_settings.gecko.strict_min_version`) with the MV3 minimums — chrome88, firefox91 — as the fallback. Custom `__theme__` / `__main_assets__` / `__project_assets__` aliases resolve to the active theme and the vendored assets. A post-emit pass substitutes `%%% version %%%` / `%%% brand.name %%%` / etc.
- **The build snapshot is ONE file.** `bundle.js` composes `OMEGA_BUILD_JSON` once per build and writes it to `dist/build.js` through `@omega.js/devkit/build-json` ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)); `package.js` copies it into every `packaged/<browser>/raw/` with the rest of `dist`. The page template loads it with `<script src="/build.js">` as its first script, and `background.js` with `importScripts('/build.js')` on its first line (the manifest declares a CLASSIC service worker, so importScripts is legal; an extension's own pages need no `web_accessible_resources` entry to fetch their own origin). No bundle carries a copy: the `define` + `banner` bake that put one config into 21 files is retired, and so is the `build.json` sidecar nothing read. The same file and the same load order web and @omega.js/desktop use.
- **The wrapper and the subset are @omega.js/config's, not this framework's** ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)). The wrapper is the ONE shape every OMEGA browser surface bakes, `{ config, package, mode, license, builtAt }`, and `config` is `clientConfig(resolved)`: the sections the schema's `client` flag marks browser-visible plus this build's facts (`runtime`, `environment`, `version`, `buildTime`, `target`, `dev`). The legacy `omega` block is gone ([#896](https://github.com/Omega-JS-Stack/omega/issues/896)): the service worker reads `config.environment`, `config.buildTime` (its cache breaker) and `config.dev.liveReloadPort`, the names every OMEGA surface spells. The hand-written allow list this task used to keep is gone, so a store artifact can no longer carry a brand's provisioning sections and a new public value is one schema row instead of three lists. The Measurement Protocol secret is the one `.env` value sanctioned into the artifact (`publicAtRest`) and is added AFTER that gate, which refuses secret-shaped keys outright. Every context hands the blob to `@omega.js/client` the same way: `const configuration = window.OMEGA_BUILD_JSON?.config;`.
- **Sass** — load-path resolution lets consumer SCSS `@use 'omega-extension'` / `@use 'theme'` / `@use 'components/popup'` without long relative paths. See [docs/css.md](../../packages/extension/docs/css.md).
- **HTML templating** — two-pass `{{ }}` replacement: view first, then outer page-template. Vars: `brand.name`, `brand.url`, `page.title`, `theme.appearance`, `version`, `cacheBust`. See [docs/templating.md](../../packages/extension/docs/templating.md).
- **Packaging** ([gulp/package.js](../../packages/extension/src/gulp/tasks/package.js)): per-browser manifest normalization (JSON5 → strict JSON), zip, optional auto-publish. The bundles arrive with the snapshot already baked in, so the package lane writes no config file of its own. A DECLARED consumer value beats the framework default, arrays included: an empty array ships nothing, the only way to drop a default like `externally_connectable`'s dev origin ([#260](https://github.com/Omega-JS-Stack/omega/issues/260)). That default is now the BRAND's own origin (from `brand.url`), with the dev-website origin added in dev builds only: a packaged build shipped the localhost origin alone, so the live site could not message the published extension ([#583](https://github.com/Omega-JS-Stack/omega/issues/583)); the scaffolded `test/boot/externally-connectable.test.js` asserts it against the real packaged manifest. `homepage_url` bakes from `brand.url` on every target: the store listing's developer-site link ([#576](https://github.com/Omega-JS-Stack/omega/issues/576)). The firefox target translates the chrome-only panel keys (`side_panel` → `sidebar_action`) and writes `browser_specific_settings.gecko.id` from the ONE home of that id, `targets.<name>.listings.firefox.id` in config ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)): a manifest declaring a DIFFERENT id fails the package naming both, and a brand that declares neither still DERIVES one, `extension@<brand.url host>` falling back to `extension@<brand.id>.extension`, failing loudly only with no brand facts at all ([#264](https://github.com/Omega-JS-Stack/omega/issues/264)). The derived id is not left implicit: the LOCAL scaffold pins it into `config/omega.json5` as `listings.firefox.id` the first time a verb runs in the target, before any push ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)), because it must stay stable across releases and `brand.url` can change ([#574](https://github.com/Omega-JS-Stack/omega/issues/574)).

See [docs/build-system.md](../../packages/extension/docs/build-system.md).

### Build modes

- `OMEGA_BUILD_MODE=true` — production build (minified, no sourcemaps, dev-blocks stripped)
- `OMEGA_IS_PUBLISH=true`: also publish to Chrome / Firefox / Edge stores after packaging, then attach the per-browser zips to a GitHub release in the brand's ONE public releases repo (`<brand.id>-releases` under `repo.org`, tag `<target name>-v<version>`, or `extension-v<version>` for the default target, [#883](https://github.com/Omega-JS-Stack/omega/issues/883)). The release is the publish TASK's own work, in node through the devkit `gh` wrapper, so a laptop publish and a CI publish upload the same assets to the same tag and no workflow YAML names a repo. Each store is addressed by the id in its own listing block, `targets.<name>.listings.{chrome,firefox,edge}.id` ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)): the id is public (it is in the listing URL), so it lives in config beside that listing's `url`, never in `.env`, and a lane whose credentials are set but whose id is not refuses naming the config path to paste it into. A FIRST Firefox publish (no `listings.firefox.id`) also writes `.temp/amo-metadata.json` and signs with `--amo-metadata` ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)): addons.mozilla.org will not CREATE a listing without a summary, a category and a license, and the credentials-only call came back `Bad Request` after a green build. The summary is `brand.description` (cut to AMO's 250-character cap, with a warning), the categories are `targets.extension.categories` (AMO slugs, default `['alerts-updates']`, an unknown slug fails the build naming the live list), and the license is the target `package.json` `license` field: absent or `UNLICENSED` lists as `all-rights-reserved`, an SPDX id AMO accepts passes through, anything else fails loudly. Every UPDATE passes nothing, as before: AMO reuses the listing the first version made. AMO's add-on guid IS the manifest's gecko id, so the create is addressed by that id too (web-ext's sign has no `--id` option; it reads the packaged manifest). The publish itself writes NO config (#893): it runs on the runner's throwaway checkout of the mirror, where a write never reached the brand tree and every deploy created the add-on again. The id is the brand's own derived value and the LOCAL scaffold pins it into `config/omega.json5` as `listings.firefox.id`, through @omega.js/config's comment-preserving editor, printing the line it wrote: nothing is left for a consumer to remember, and the next publish reads it and updates

**Which stores a publish talks to is the DECLARATION, not a credential's presence** ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)). `platforms.<chrome|firefox|edge>.formats.store` is the switch, and each store's lane has exactly three outcomes, in the same words the desktop publish uses (both read devkit's `ship-plan`, which reads @omega.js/config's format table):

- **Keys present, listing addressable** (chrome and edge with `listings.<browser>.id` in config, firefox always, since AMO takes the manifest gecko id): published. A store that rejects the upload fails the publish, and its row in the store table printed at the end carries the reason, `Firefox Add-ons: ✗ Failed: <reason>`, as does the thrown `Publish failed for firefox: <reason>` ([#940](https://github.com/Omega-JS-Stack/omega/issues/940)). A store that already holds the version is a failure too, never a pass, and its reason names the fix (`version 0.0.4 already exists on Firefox Add-ons. Bump version in package.json and deploy again.`); any other rejection prints the store's own last line, web-ext's `WebExtError:` line rather than the npm warnings above it.
- **A declared store with a missing developer key**: the publish REFUSES, naming the key, the declaration that requires it (`platforms.edge.formats.store`), and the ONE walk that collects it, `omega manage --service publishing`. Nothing is uploaded to any store. Dropping the store (`platforms.edge.formats.store: false`) is how a brand says it does not ship there; a store that quietly fell off the run because a key was empty is what this replaced.
- **Keys present, no listing id yet**: ONE manual step prints (create the listing at the store's console, upload `extension-<build>.zip` from the release, set `targets.<name>.listings.<browser>.id`, re-run) and the run finishes green. The zips are already on the release by then: that upload runs FIRST, so the file a human uploads by hand is published no matter which stores went through.

- `OMEGA_TEST_MODE=true` — running inside @omega.js/extension's test framework. Powers `Manager.isTesting()`.
- `OMEGA_LIVERELOAD_PORT=35729` — WebSocket port for `serve` task
- `OMEGA_LOG_FILE` — override the gulp stdout/stderr tee path, or `false` to disable it

### Themes

Two themes ship with @omega.js/extension: `bootstrap` (pure Bootstrap 5.3+) and `classy` (Bootstrap + custom design system). Plus `_template/` for new themes. Activate via `config.theme.id`; appearance via `config.theme.appearance` ('dark' / 'light'). Variables overridable from consumer SCSS via `@use 'omega-extension' as * with ($primary: …)`, and `$primary` itself arrives from `brand.color`: the sass task renders `dist/assets/css/_brand.scss` before every compile (`$primary` plus a `ramp` mixin of the runtime `--omega-accent` family), and the scaffold's `main.scss` reads both, `@use 'brand';` above the framework import and `@include brand.ramp;` below it. A deliberate divergence puts a literal back in place of `brand.$primary`. Same mechanism, same renderer, on @omega.js/desktop ([#912](https://github.com/Omega-JS-Stack/omega/issues/912), [shared/theming.md](../shared/theming.md)). `theme.id` is a SHARED config key while the theme SET is per-framework, so both resolve sites (sass load path, the bundler's `__theme__` alias) go through [src/lib/theme.js](../../packages/extension/src/lib/theme.js): an id this framework doesn't ship falls back to `classy` with one warning naming the key, the value, and the valid set; override per target with `targets.extension.theme.id` ([#261](https://github.com/Omega-JS-Stack/omega/issues/261)). See [docs/themes.md](../../packages/extension/docs/themes.md).

### Defaults system

`src/defaults/` is the starter template — copied to consumer projects by every verb's `ensureTarget()`. File behavior (overwrite/skip/template/rename) is controlled by `FILE_MAP` in [gulp/tasks/defaults.js](../../packages/extension/src/gulp/tasks/defaults.js). Most consumer files default to `overwrite: false` so user code is never clobbered. Inside a brand monorepo the map also skips `.github/**`: GitHub runs workflows from the REPO ROOT only, so the scaffold composes the target's CI into the brand root as `.github/workflows/<target>-publish.yml` — target-scoped, per-target concurrency, regenerated (never duplicated) on every verb, and `omega deploy` dispatches that composed name ([#265](https://github.com/Omega-JS-Stack/omega/issues/265)). See [docs/defaults.md](../../packages/extension/docs/defaults.md).

The workflow's `env:` carries `GOOGLE_ANALYTICS_SECRET` beside the seven store credentials (the three listing IDS left that block with #893: a public id rides the config snapshot, never a repo secret): a dispatched run has no `.env`, so the Measurement Protocol secret the build bakes into `OMEGA_BUILD_JSON` only reaches it from the repo secrets, and without it every CI-published extension shipped an empty secret and sent no events. A build-mode build of a brand with `analytics.providers.google.id` set now FAILS when the secret is empty ([#582](https://github.com/Omega-JS-Stack/omega/issues/582)).

### Auto-translation

`npm run build` invokes the `translate` gulp task: reads `config/messages.json`, sends only the strings missing from the committed `translations/<lang>/` cache to the provider, and composes `dist/_locales/<lang>/messages.json` per language in `translation.languages` (omega.json5; unset = off). Existing translations are preserved. See [docs/translations.md](../../packages/extension/docs/translations.md).

The English source is seeded from the brand: the scaffold renders `appName` / `appNameShort` / `btnTooltip` from `brand.name`, and `appDescription` from `brand.description` when it fits the 200-character store cap — otherwise "The official &lt;brand&gt; browser extension." ([#573](https://github.com/Omega-JS-Stack/omega/issues/573)). All four render through ONE escape — each lands inside a single-quoted JSON5 value, and the brand-name paths used to render raw, so a name carrying an apostrophe seeded an unparseable file ([#592](https://github.com/Omega-JS-Stack/omega/issues/592)). `config/messages.json` is copy-once, so the seed is a starting point, never a rewrite.

### Build hooks

Three lifecycle hooks let consumers run custom logic while the extension is packaged and deployed:
- `hooks/build/pre.js` — after `dist/` is built but before `packaged/` is assembled
- `hooks/build/post.js` — after packaging (and after store publishing if `OMEGA_IS_PUBLISH=true`)
- `hooks/deploy/pre.js`: inside `omega deploy`, after the local scaffold and before the network precheck, on both lanes (the dispatch and `--direct`); a dry run skips it, because a hook may act on the world and a dry run promises to send nothing ([#900](https://github.com/Omega-JS-Stack/omega/issues/900): the playground's bumps its patch version and prunes its release family, since a store refuses a version it already holds). Its `mode` is always `'production'`: the verb runs outside a build, and what it is about to publish is a release

The NESTED path is the one the defaults scaffold writes and `npx omega migrate` moves flat files to; the package task resolves it first and falls back to the flat pre-migration `hooks/build:pre.js` during the transition. It used to resolve ONLY the flat path, so every migrated consumer's hooks were dead and the miss printed an untagged `console.warn` ([#571](https://github.com/Omega-JS-Stack/omega/issues/571)).

All three receive the ONE hook-argument shape every OMEGA framework passes: `{ manager, projectRoot, mode }`, the same `ctx` @omega.js/desktop hands its lifecycle hooks ([docs/desktop/index.md](../desktop/index.md)), and everything else comes off `manager` (`getManifest()`, `getConfig()`, `getPackage('project')`). The package task used to pass its internal watch counter while both docs described an `index` build-info object nothing ever built, so a hook written from the docs read `undefined` at its first property ([#591](https://github.com/Omega-JS-Stack/omega/issues/591)). Async. See [docs/hooks.md](../../packages/extension/docs/hooks.md).

### Cross-context helpers

Every Manager (build + 7 runtime contexts) has the same set of static + instance helpers via `attachTo(Manager)` mixin from `src/utils/mode-helpers.js`:

- `Manager.getEnvironment()`: `'development' | 'testing' | 'production'` (mutually exclusive)
- `Manager.isDevelopment()` / `Manager.isTesting()` / `Manager.isProduction()`: each DERIVES from `getEnvironment()`, so exactly one is true and `isProduction()` is a real positive check, NOT `!isDevelopment()`
- `Manager.getVersion()` — extension version (`chrome.runtime.getManifest().version` in browser, `package.json#version` in Node)

**The environment four are `@omega.js/config`'s ONE module** ([#817](https://github.com/Omega-JS-Stack/omega/issues/817), the contract in full: [docs/shared/config.md](../shared/config.md)): this file re-exports them beside the extension's own `getVersion()`, so `@omega.js/extension`, `@omega.js/desktop`, `@omega.js/web` and `@omega.js/backend` all hang the identical functions. They read ONE input and never guess: `OMEGA_ENVIRONMENT` in build-time Node, and the baked `OMEGA_BUILD_JSON.config.environment` in an extension context (which has no `process.env`). Nothing sniffs `manifest.update_url` or `NODE_ENV` any more, so what an artifact WAS BUILT AS is what it answers, wherever it is loaded from, and a context with neither input throws by name rather than defaulting. `src/build.js` names the input at load, from the lane: `OMEGA_BUILD_MODE` (the `omega build` flag) is production and wins over an inherited value, the `test` verb names `testing`, and a bare dev boot is `development`.

Gate side effects on the INTENTIONAL check (`isProduction()` for prod-only, `isDevelopment() || isTesting()` for local-or-test); never `!isDevelopment()`. Use these instead of grepping `process.env` ad-hoc. See [docs/environment-detection.md](../../packages/extension/docs/environment-detection.md).

### Test framework

`npx omega test` discovers + runs:
- `<@omega.js/extension>/dist/test/suites/**/*.js` — framework defaults
- `<cwd>/test/**/*.js` — consumer suites

Four layers:
- **build** — plain Node, fast. Manager API, config validation, manifest shape, lib utilities.
- **background** — real MV3 service worker via Puppeteer + CDP. Boot sequence, `chrome.runtime` surface, storage round-trips, messaging.
- **view** — Chromium tab loading harness `popup.html` / `options.html` / `sidepanel.html`. DOM bindings, Manager surface, popup ↔ background messaging.
- **boot** — real headless Chromium loading the **consumer's** `packaged/<browser>/raw/` as an unpacked extension. End-to-end: does the real packaged extension boot?

The boot layer SKIPS when the consumer has not built: a candidate directory qualifies only when its `manifest.json` is strict JSON, so the intermediate `dist/` (JSON5, and present after any dev run or `omega clean`) is passed over and named in the skip instead of loading and failing every boot test ([#575](https://github.com/Omega-JS-Stack/omega/issues/575)). An explicitly named `OMEGA_TEST_BOOT_DIR` still fails loudly — that one is a decision, not a fallback.

A boot test's per-test timeout defaults to **45000ms** — sized for the FIRST run after a fresh build, where the extension's Firebase service worker initializes cold (observed 20-30s; the old 20000 default sat right under it and consumers had to declare a timeout of their own to get a green run, [#262](https://github.com/Omega-JS-Stack/omega/issues/262)). Later runs are far quicker. Declare `timeout` on a test only when THAT test is genuinely slower — never to work around the first-run cost.

Test files export `{ type, layer, description, tests, cleanup }` with `run` (build/background/view) or `inspect` (boot). Same `ctx.expect` / `state` / `skip` API as @omega.js/desktop and @omega.js/backend. CSP-safe ([docs/test-framework.md](../../packages/extension/docs/test-framework.md)) — test bodies are inlined as literal async-function expressions at runner build-time, not eval'd inside the SW.

**NEVER mock — test against the real harness.** Every layer gives you the real runtime (real MV3 SW, real Chromium tab + DOM, real packaged extension), so never hand-roll a `mockManager`, fake `chrome`/`browser`, or stubbed context. Only pure functions (zero I/O) are called directly. Real external APIs (Firebase, etc.) are GATED behind extended mode (`npx omega test --extended` or `TEST_EXTENDED_MODE=true`) — normal mode skips them in-source via `ctx.skip(process.env.TEST_EXTENDED_MODE)`, NOT mocked; extended-mode tests must clean up anything they create externally. See [docs/test-framework.md](../../packages/extension/docs/test-framework.md).

See [docs/test-framework.md](../../packages/extension/docs/test-framework.md) and [docs/test-boot-layer.md](../../packages/extension/docs/test-boot-layer.md).

### Test coverage

Every feature ships with tests at EVERY layer it has a surface in — logic (`build`/`background`), UI (`view` — real events on the real DOM), and end-to-end (`boot`). Skip a layer ONLY when the feature genuinely has no surface there (a pure build utility has no UI; a CSS-only tweak has no logic). "The logic test already covers it" is NOT a reason to skip the UI test — logic tests prove the logic, UI tests prove the wiring, boot tests prove the built artifact. See [docs/test-framework.md](../../packages/extension/docs/test-framework.md).

## CLI

`npx omega <command>` (bins `omega`, `omg`, `mgr`, all the same dispatcher; bare `omega` prints the listing). Every verb runs `ensureTarget()` first: the local scaffold the retired `omega setup` used to own ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): scripts, the Firefox listing-id pin, Node check, peer deps, the defaults tree, the locality warning. The PIN is the derived AMO add-on id written into the brand's `config/omega.json5` as `targets.<name>.listings.firefox.id` when the brand declares none ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)): the id is ours, not the store's, it must stay stable after the first upload, and the scaffold is the one step that runs on the LAPTOP before the deploy's snapshot is pushed, so the value rides that snapshot instead of being written on a runner's throwaway checkout. It writes no `.env` ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)): the brand root's `.env` is the one file humans and the manager edit, and a target `.env` is an optional per-key override you author yourself. The scripts it syncs spell the verb BARE (`omega test`, never `npx omega`): npm already puts `node_modules/.bin` on the path inside a script; the `npx` form stays canonical for docs and the terminal ([#748](https://github.com/Omega-JS-Stack/omega/issues/748)). The gulp lane gets it from the `defaults` task; `test` and `deploy` call it themselves:

| Command | Description |
|---|---|
| `migrate` | the one-time, version-gated upgrade moves (today: flat `hooks/*.js` → the nested layout). It used to run on every setup; a MOVE is a deliberate verb, not idempotent healing (aliases `-m`, `--migrate`, `migration`) |
| `clean` | remove `dist/`, `packaged/`, `.cache/`, `.temp/` |
| `build` | clean + `gulp build`, with `OMEGA_BUILD_MODE=true` set in-process — the production build the consumer's `build` script is now a thin alias of, the same shape desktop's verb has ([#81](https://github.com/Omega-JS-Stack/omega/issues/81)). Aliases `-b`, `--build` |
| `install` | install peer deps |
| `deploy` | dispatch the CI publish workflow (the deliberate-deploy verb; see docs/shared/deploys.md in the Omega repo), or with `--direct` run the ONE command CI runs right here, `npm run build` with `OMEGA_IS_PUBLISH=true` ([#865](https://github.com/Omega-JS-Stack/omega/issues/865)): the local build, the store publish the build series ends in, and the release upload to `<brand.id>-releases` ([#872](https://github.com/Omega-JS-Stack/omega/issues/872), [#883](https://github.com/Omega-JS-Stack/omega/issues/883)). A DISPATCH runs the NETWORK prechecks first: framework freshness, then the secrets push ([#680](https://github.com/Omega-JS-Stack/omega/issues/680)), which is `fatal` ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the store credentials and GA secret the schema delivers to extension, published as repo Actions secrets through the shared devkit publisher; `--no-secrets` skips them (the same opt-out name on every target) and `--direct` never reaches them (a local deploy publishes no store credentials to the repo, #872) |
| `version` | print versions |
| `help` | command listing (router built-in; also `-h`/`--help`) |
| `test` | run the project's test suites (`framework:` / `full:` reach the framework suite) |
| `update` | dependency freshness report (installed/wanted/latest + patch/minor/major, < 7-day releases QUARANTINED); `--apply` installs the safe set via npu, `--major` explicit. Aliases: `outdated`, `out`. See docs/shared/updates.md in the Omega repo |

See [docs/cli.md](../../packages/extension/docs/cli.md).

## Dependency Resolution

- **Consumer code can `require()` any @omega.js/extension dependency** — the bundler's framework-deps resolve hook re-resolves every name the framework DECLARES from the framework's own installation. Consumer projects do NOT need to `npm install firebase`, `@omega.js/client`, or any other @omega.js/extension dep. If a dep doesn't resolve, the fix is in @omega.js/extension's `package.json` — not the consumer's.
- **The framework's copy wins ([#87](https://github.com/Omega-JS-Stack/omega/issues/87)).** A consumer that declares its own version of a framework dependency still bundles ONE copy — the framework's — the same guarantee @omega.js/web and @omega.js/desktop give, through the same @omega.js/devkit hook since [#738](https://github.com/Omega-JS-Stack/omega/issues/738). The DECLARED set is the list, so — unlike webpack's `resolve.modules` order, which this replaced — a package the framework merely carries TRANSITIVELY no longer wins: it resolves the way node resolves it. Same shape in [docs/desktop/index.md](../desktop/index.md); pinned by `src/test/suites/build/framework-deps.test.js` in both.
- **@omega.js/client owns Firebase.** Consumer code NEVER imports Firebase directly (`require('firebase')` / `import('firebase/app')`). Use `import omega from '@omega.js/client'` → `omega.auth()`, `omega.firestore()`. Same rule in EM and UJM.
- **`Manager.require(name)`** resolves from @omega.js/extension's module context at runtime (static + prototype). Use in gulp tasks or unbundled code (e.g. test fixtures). The bundler's framework-deps hook handles the bundled case.

## Development Workflow

- **🚫 NEVER use `npx omega ...` from the framework repo**: `npx omega` is for CONSUMER projects only (where the bin lives in `node_modules/.bin/`). From the framework repo, use `npm test`, `npm start`, etc. The `scripts` in `package.json` call `node bin/omega` directly. This applies to ALL four OMEGA frameworks.
- **🚫 NEVER run `npm start`** (consumer projects) — it's the user's long-running dev watcher. Assume it's already running; if it isn't, **instruct the user to run it** rather than running it yourself (running it again kills theirs). To see output, **read the `logs/*.log` files** (`dev.log`, `build.log`, `test.log`) — never tail/attach to the process. Running `npx omega test` is fine.
- **Where the output logs live:** the gulp pipeline tees all stdout/stderr to `<projectRoot>/logs/dev.log` (on `npm start`) or `logs/build.log` (on `npm run build`), truncated fresh each run, ANSI-stripped. `cat logs/dev.log` (or `grep` it) instead of scrolling scrollback — never restart the watcher to see output it already wrote. `npx omega test` writes `logs/test.log`. See [docs/build-system.md](../../packages/extension/docs/build-system.md#log-files); the cross-framework tee contract and the full path table are [docs/shared/logging.md](../shared/logging.md).
- **After editing files**, verify the gulp watcher recompiled successfully. Check for esbuild/sass errors in the console output. A change that breaks the build is not a completed change.
- **Live-test the extension via CDP.** Use the `chrome-devtools-extension` MCP upstream: it launches a per-session Chrome for Testing with the unpacked extension pre-loaded (`OMEGA_CDP_EXTENSION_PATH="$(pwd)/packaged/chrome/raw" claude`, then `router__enable_upstream`; stable Chrome ignores `--load-extension`). Plain web pages (no extension needed): the regular `chrome-devtools` MCP tools; your session auto-launches its own private Chrome on the first tool call. This is the primary way to confirm UI changes: type-checking and test suites verify code correctness, not feature correctness. See [docs/cdp-debugging.md](../../packages/extension/docs/cdp-debugging.md) + `~/.claude/mcp-server/servers/chrome-devtools-extension/CLAUDE.md`.

## Supply-Chain Security

All `npm install` calls in CLI commands (`npx omega i`, the peer-dependency step of every verb's `ensureTarget()`) route through the `safeInstall()` helper (`src/lib/safe-install.js`). It prefixes `sfw` (Socket Firewall) when installed, blocking confirmed malware at the network level before packages reach disk. Falls back to plain npm if sfw isn't available. CI workflows get the firewall from Socket's own GitHub Action (`SocketDev/action`, firewall mode, pinned; it downloads the binary with the job's token and caches it, so a hosted runner's shared anonymous API quota never fails the step, [#871](https://github.com/Omega-JS-Stack/omega/issues/871)) and run `sfw npm ci`, the one install step every lane shares ([#938](https://github.com/Omega-JS-Stack/omega/issues/938)). The template carries only the `{{ installFirewall }}` token; the composer renders the step, once, from devkit's one pinned constant ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). Installs will **fail if sfw detects confirmed malware** in any package in the dependency tree; non-critical CVEs and quality warnings pass through.

## File Conventions

- **CommonJS** (`require()`) for build-time + Node code (gulp, CLI, tests). **ES modules** (`import`/`export default class`) for browser-context Manager files (`background.js`, `popup.js`, etc.) — they go through esbuild.
- One `module.exports = ...` per file (CommonJS).
- Logical operators at the **start** of continuation lines.
- Short-circuit early returns rather than nested ifs.
- Prefer **`fs-jetpack`** over `fs-extra`.
- **No backwards compatibility** unless explicitly requested.
- **No paranoid `?.`** — see [the defensive-coding rule](https://anthropic.com/claude-code) (also enforced in `~/.claude/skills/js:patterns`). Framework internals deref directly; `?.` is for genuinely-uncertain values (user config sub-fields, `chrome.*` APIs that may be absent, regex matches, caught exceptions).
- **Browser-context modules are ES-module.** esbuild compiles them. Don't try to `require()` them from Node — they reference `window`, `document`, `chrome` at module-load time. Build-layer tests should target `lib/*.js` (Node-safe) or use @omega.js/extension's public Manager API (`require('@omega.js/extension/build').getConfig()`).
- **Consumer pattern: use the public Manager API in tests.** Don't `require('json5')` or other transitive @omega.js/extension deps directly from consumer test files — they're not in the consumer's `package.json` and resolution is fragile. Use `Manager.getConfig()` / `Manager.getManifest()` / `Manager.require('json5')`.

## Doc-update parity

Whenever you make a behavioral change (new command, new flag, new pattern, removed feature), update:

1. **`README.md`** — user-facing summary
2. **`docs/extension/index.md`** (this file) — architecture overview, one paragraph or cross-link
3. **`docs/<topic>.md`** — the meat. If a topic doesn't have a doc yet, create one.
4. **`CHANGELOG.md`** — if the project keeps one

Don't ship behavioral changes with stale docs. Validate first, then document — write docs that describe shipped reality, not intentions.

**The four framework guides are structurally MIRRORED.** [docs/web/index.md](../web/index.md), [docs/backend/index.md](../backend/index.md), [docs/desktop/index.md](../desktop/index.md), and [docs/extension/index.md](../extension/index.md) keep the same section skeleton in the same order, and each consumer template (`src/defaults/AGENTS.md`; web's lives at `scaffold/AGENTS.md`) mirrors its guide. Never add, rename, or reorder a section in one without making the SAME change in the others in the same pass.

## Documentation

API references for each subsystem live in `docs/`:

### Architecture
- [docs/components.md](../../packages/extension/docs/components.md) — seven component contexts, three-part structure (view + styles + script), manifest wiring
- [docs/managers.md](../../packages/extension/docs/managers.md) — one-line bootstrap per context, import paths, `initialize()` flow
- [docs/environment-detection.md](../../packages/extension/docs/environment-detection.md) — `Manager.isTesting / isDevelopment / isProduction / getVersion`

### Runtime
- [docs/extension.md](../../packages/extension/docs/extension.md) — cross-browser `chrome.*` / `browser.*` API wrapper
- [docs/auth.md](../../packages/extension/docs/auth.md) — cross-context auth sync, sign-in / load / sign-out flows, button CSS classes
- [docs/verts.md](../../packages/extension/docs/verts.md) — `[data-omega-vert]` auto-bind to @omega.js/client's verts module on page surfaces (live via MutationObserver): house/company lane ONLY (type pinned 'house' — no AdSense; content scripts never bind)
- [docs/affiliatizer.md](../../packages/extension/docs/affiliatizer.md) — the content script's affiliate-link redirect on matched partner hostnames (a fixed framework-level map, not brand config): default-on, once per partner per 24h, `?affiliatizerStatus=block|allow|reset` control, store-listing disclosure
- [docs/offscreen.md](../../packages/extension/docs/offscreen.md) — offscreen document lifecycle, creation from background, messaging
- [docs/xss-prevention.md](../../packages/extension/docs/xss-prevention.md) — escapeHTML/sanitizeURL canonical forms, extension attack vectors

### Build
- [docs/build-system.md](../../packages/extension/docs/build-system.md) — gulp pipeline, esbuild, sass, html, packaging
- [docs/templating.md](../../packages/extension/docs/templating.md) — `{{ }}` token replacement, available vars, page template
- [docs/css.md](../../packages/extension/docs/css.md) — SCSS load paths, framework + theme + project resolution
- [docs/themes.md](../../packages/extension/docs/themes.md) — bootstrap / classy / `_template`, variable overrides, dark mode
- [docs/shared/icons.md](../../packages/extension/docs/icons.md) — one source icon → all generated sizes, manifest wiring
- [docs/defaults.md](../../packages/extension/docs/defaults.md) — `src/defaults/` system, `FILE_MAP` rules
- [docs/hooks.md](../../packages/extension/docs/hooks.md) — `build:pre` / `build:post` lifecycle hooks
- [docs/translations.md](../../packages/extension/docs/translations.md) — auto-translate to the configured `translation.languages`

### Operations
- [docs/cli.md](../../packages/extension/docs/cli.md) — commands, aliases, env var conventions
- [docs/cdp-debugging.md](../../packages/extension/docs/cdp-debugging.md) — launching a controllable Chrome (CDP), loading the unpacked extension (persistent agent profile — `--load-extension` is dead on stable Chrome), driving via MCP/CDP
- [docs/logging.md](../../packages/extension/docs/logging.md) — `dev.log` / `build.log` / `test.log` tee, controls
- [docs/common-mistakes.md](../../packages/extension/docs/common-mistakes.md) — the canonical "don't do this" list
- [docs/audit.md](../../packages/extension/docs/audit.md) — full-audit check catalog (U-xx universal / EXT-xx / F-xx IDs with severity + scope), protocol + fix loop
- [docs/shared/publishing.md](../../packages/extension/docs/publishing.md) — Chrome / Firefox / Edge store auto-publishing, credentials, CI, store listing description format (`config/description.md`)

### Testing
- [docs/test-framework.md](../../packages/extension/docs/test-framework.md) — writing tests, four layers, `ctx` + `expect` API
- [docs/test-boot-layer.md](../../packages/extension/docs/test-boot-layer.md) — boot layer (loads consumer's actual packaged extension)
