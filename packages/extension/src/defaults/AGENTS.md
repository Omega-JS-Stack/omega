# ========== Default Values ==========
# OMEGA Extension (@omega.js/extension) consumer project

<!-- MAINTAINERS (framework repo): this consumer template is MIRRORED across all OMEGA framework consumer templates (src/defaults/AGENTS.md ×N; web's lives at scaffold/AGENTS.md).
  Same sections in the same order: framework-specific extras may be inserted; canonical sections are never reordered/renamed. Edit every framework consumer template together.
  The mirroring rule lives in each framework guide's Doc-update parity section (docs/<framework>/index.md) -->

## Framework

This project consumes **OMEGA Extension** (`@omega.js/extension`), a comprehensive framework for building modern cross-browser extensions (Chrome, Firefox, Edge; a Chromium browser like Brave installs the Chrome build).
- The framework provides one-line bootstrap per extension context, a component-based architecture (view + styles + script per context), and a multi-browser build/release pipeline that produces store-uploadable zips.
- It also carries cross-context auth synchronization and a built-in four-layer test framework.

## 🚨 READ THE FRAMEWORK DOCS FIRST

**Before doing ANY work on this codebase, the agent MUST read the framework documentation: that is where the architecture, conventions, APIs, and gotchas live. Skipping these will result in solutions that conflict with framework patterns.**

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`**: the OMEGA map, the one agent entry into the framework docs; follow it to `docs/extension/index.md` (the @omega.js/extension guide: identity, architecture, conventions)
- **`node_modules/@omega.js/extension/docs/`**: subsystem deep references (read the relevant ones for the task at hand)

## 🚨 READ @omega.js/client TOO

**OMEGA Extension ships `@omega.js/client` in its page contexts: the popup, options, sidepanel and page instances extend the client's base class, so `omega.auth`, `omega.storage`, `omega.bindings` and the rest are properties of the one `omega` each context imports.** The background service worker carries its own `omega.auth` (the source of truth the page contexts sync with over `omega.messenger`); content and offscreen have no auth.
- It powers auth, Firebase, reactive `data-omega-bind` directives, analytics, error tracking, and utilities (`escapeHTML`, etc.).
- Any task that touches auth flows, Firestore reads/writes, subscription resolution, push notifications, or DOM bindings means you are working with @omega.js/client as much as with the extension framework.

**Required reading:**
- **`node_modules/@omega.js/AGENTS.md`** → `docs/client/index.md`, the @omega.js/client guide: identity, module list, conventions
- **`node_modules/@omega.js/client/docs/`**: module deep references (Auth, Bindings, Firestore, Notifications, etc.)

## Quick start

```bash
npm start                   # dev with live reload (gulp → esbuild → serve)
npm run build               # production build → dist/ + packaged/<browser>/raw/ + .zip per browser
OMEGA_IS_PUBLISH=true npm run build   # build + auto-upload to Chrome / Firefox / Edge stores
npx omega test                # run YOUR project's test suites (bare runs never include the framework corpus)
npx omega test build/config         # bare path: run project tests matching a path (full:<path> for both sources)
npx omega test project:             # run ONLY your project tests (project:<path> to narrow)
npx omega test mgr:                 # run ONLY framework tests (extension: / framework: are equivalent aliases)
npx omega test extension:build/config     # run only framework tests matching a path
# Positional target selects which test FILES run; --filter=<substring> matches test NAMES within them
npx omega test --extended           # also run tests that hit REAL external services (off by default; TEST_EXTENDED_MODE=true is the env equivalent, a shared name across all OMEGA frameworks)
# (output is teed to logs/: dev.log on `npm start`, build.log on `npm run build`, test.log on `npx omega test`; cat instead of scrolling scrollback)
npx omega install dev         # use LOCAL @omega.js/extension source (to test framework edits)
npx omega install live        # restore the published @omega.js/extension from npm
```

> Editing the framework source while working here? Run `npx omega install dev` so this project picks up your uncommitted framework changes (it otherwise uses its installed `node_modules/@omega.js/extension`). Run `npx omega install live` to switch back.

Load the unpacked extension in Chrome: point chrome://extensions → "Load unpacked" at `packaged/chrome/raw/`.

## Where things live

- `config/omega.json5`: the single OMEGA config (JSON5), with shared sections (brand, cloud, analytics, monitoring, theme) at the top level + `targets.extension` for extension-specific settings. `require('@omega.js/extension/build').getConfig()` returns it RESOLVED (target section overlaid onto the top level). Secrets never live here; they go in `.env` (e.g. `GOOGLE_ANALYTICS_SECRET`).
  - What the extension SHIPS is one declaration: `platforms.<chrome|firefox|edge>.formats.<zip|store>`. Presence = enabled, every browser and format is on by default, and `false` drops one (`edge: false`). Edge ships the chrome build.
- `config/messages.json`: i18n source. Auto-translated at build time to the languages in `translation.languages` (omega.json5); only missing keys regenerated, cache committed under `translations/`.
- `config/description.md`: store-listing description (used by the publish step).
- `src/manifest.json`: extension manifest. The framework merges its defaults in at build time; you only need to declare what's specific to your extension.
  - Anything you DO declare wins outright — an array you write replaces the framework's, and an empty one ships nothing.
  - The firefox artifact needs `browser_specific_settings.gecko.id` (packaging fails without it) and gets `side_panel` translated to `sidebar_action` automatically.
- `src/assets/images/`: static images. They copy to `dist/` as-is — no hook, no imagemin step.
- `src/views/<context>/index.html`: per-context HTML (popup / options / sidepanel / pages).
- `src/assets/js/components/<context>/index.js`: per-context script entry. One-line bootstrap of `@omega.js/extension/<context>`.
- `src/assets/css/components/<context>/index.scss`: per-context styles.
- `src/assets/js/components/background/index.js`: MV3 service worker entry. Source of truth for auth + messaging.
- `hooks/build/{pre,post}.js`: optional lifecycle hooks.
- `test/**/*.js`: your project test suites (framework auto-runs them alongside its own).

## Per-context imports

```js
// src/assets/js/components/popup/index.js
import omega from '@omega.js/extension/popup';
await omega.initialize();

// src/assets/js/components/background/index.js  (service worker)
import omega from '@omega.js/extension/background';
await omega.initialize();

// Same shape for options / sidepanel / content / page / offscreen
```

## Available APIs at runtime

Each context module's default export is ONE ready-made instance, `omega`; a consumer never writes `new`. After `initialize()` (or `await omega.ready`), every context's `omega` carries:
- `omega.extension`: cross-browser `chrome.*` / `browser.*` / `window.*` wrapper
- `omega.logger`: timestamped per-context logger
- `omega.messenger`: the one lane between contexts (`send({ destination, command, payload })`, `onMessage(handler)`)
- `omega.config`, `omega.version`, `omega.getApiUrl()`
- `omega.isDevelopment()` / `isProduction()` / `isTesting()`: cross-context helpers. `getEnvironment()` returns `'development' | 'testing' | 'production'` (mutually exclusive; testing wins). Gate side effects on the intentional check (`isProduction()` for prod-only; `isDevelopment() || isTesting()` for local-or-test), never `!isDevelopment()`.

The page contexts (popup, options, sidepanel, page) also carry the client's modules (`omega.auth`, `omega.storage`, `omega.bindings`, `omega.firestore`, `omega.analytics`, ...). `omega.auth.user` is always a `User` (`authenticated`, `plan`, `active`, `profile.displayName`); `omega.auth.openPage()` opens the brand site's sign-in page in a new tab. Background's `omega.auth.user` is the same `User`, built from the account the page contexts push.

Auth UI is declarative: add `.omega-signin` / `.omega-signout` / `.omega-account` to buttons; the framework wires them. Show/hide based on auth state via `data-omega-bind="@show auth.user.authenticated"`.

## Dependency resolution

- **Do NOT install framework dependencies directly** (`firebase`, `@omega.js/client`, etc.). The framework's bundler resolves them through the framework's own `node_modules/`. If something doesn't resolve, the issue is in the framework's declared dependencies, not your `package.json`.
- **@omega.js/client owns Firebase.** Never `import firebase from 'firebase/app'`. Use the context's instance: `omega.auth`, `omega.firestore`.

## Testing

Every feature ships with tests at every layer it has a surface in: **logic** (`test/build/`, `test/background/`), **UI** (`test/view/`: real events on the real DOM), and **end-to-end** (`test/boot/`).
- Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the UI test.
- See `test/README.md` and `node_modules/@omega.js/extension/docs/test-framework.md`.

<!-- Everything above this marker is owned by the framework and rewritten by every omega verb. Add your project-specific notes below — they are preserved. -->

# ========== Custom Values ==========

## Project-specific notes

Add anything specific to THIS project here. Edits below this line are preserved across framework re-syncs.
