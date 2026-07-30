<p align="center">
  <a href="https://itwcreativeworks.com">
    <img src="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg" width="100px">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@omega.js/extension.svg">
  <img src="https://img.shields.io/npm/dm/@omega.js/extension.svg">
  <img src="https://img.shields.io/node/v/@omega.js/extension.svg">
  <img src="https://img.shields.io/npm/l/@omega.js/extension.svg">
  <br>
  <br>
  <a href="https://itwcreativeworks.com">Site</a> | <a href="https://www.npmjs.com/package/@omega.js/extension">NPM Module</a> | <a href="https://github.com/Omega-JS-Stack/omega">Omega Monorepo</a>
  <br>
  <br>
  <strong>OMEGA Extension</strong> is a framework for building modern cross-browser extensions. One-line bootstrap per context, component-based architecture, multi-browser build pipeline, cross-context auth, auto-translation across 16 languages, and a four-layer test framework.
</p>

## 🦄 Features

- **Build for any browser**: Chrome, Firefox, Edge, Opera, Brave
- **Component architecture**: seven contexts (background / popup / options / sidepanel / content / pages / offscreen) each with view + styles + script
- **One-line bootstrap per context** with cross-browser API wrapper
- **Cross-context auth sync**: sign-in in one tab is reflected in all open contexts (no `chrome.storage` needed)
- **Vert (ad) units with zero JS**: drop `<div data-omega-vert></div>` into a popup/options/sidepanel/page view — auto-bound to the shared OMEGA verts module (house/company inventory only, no AdSense). See [docs/verts.md](docs/verts.md)
- **Auto-translation** to 16 languages via Claude CLI on every build
- **Four-layer test framework**: build / background / view / boot — real Chromium, real MV3 service worker, real consumer extensions
- **Multi-browser packaging + auto-publish** to Chrome / Firefox / Edge stores from one command
- **Theme system**: Bootstrap 5 + Classy (custom design system), or roll your own
- **SCSS load paths**: `@use 'omega-extension'` / `@use 'theme'` Just Work — no relative-path hell

## 🚀 Getting started

1. `npm i @omega.js/extension` in your project (or start from an empty directory — `npx omega setup` scaffolds everything).
2. Set up + run:
   ```bash
   npm install
   npx omega setup
   npm start
   ```
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the `packaged/chromium/raw` folder in your project.
6. Your extension is loaded and live-reloads on source changes.

## 📦 Sync with the template

Run `npx omega setup` again to pull the latest framework defaults. Files you've edited are preserved; only missing or framework-owned files update.

## 🧪 Testing

@omega.js/extension ships a built-in four-layer test framework. Write tests under `test/<layer>/*.test.js` and run with:

```bash
npx omega test                   # YOUR project's tests only (C5 scoping — docs/shared/testing.md)
npx omega test framework:        # the framework's own suite (aliases: omega:, mgr:, extension:)
npx omega test full:             # both sources
npx omega test --layer build     # build layer only (plain Node, fast; orthogonal to scoping)
npx omega test --layer boot      # real-Chromium end-to-end test
npx omega test --extended        # also run extended suites against REAL external services (Firebase, etc.)
```

Tests run against the **real** harness — a real MV3 service worker, a real Chromium tab, the real packaged extension. **Never mock** (`chrome`, the Manager, contexts are all real); only pure, I/O-free functions are called directly. Real external APIs are gated behind **extended mode** — `--extended` or the shared, unprefixed `TEST_EXTENDED_MODE=true` env var (skipped in-source otherwise, never mocked).

All CLI output also lands in `logs/` (ANSI-stripped, truncated each run) — `test.log` from `npx omega test`, `dev.log` from `npm start`, `build.log` from `npm run build`. Details: [docs/logging.md](docs/logging.md).

Test files use Jest-compatible matchers:

```js
// test/build/manifest.test.js
const Manager = require('@omega.js/extension/build');

module.exports = {
  layer: 'build',
  description: 'manifest is valid MV3',
  run: (ctx) => {
    const m = Manager.getManifest();
    ctx.expect(m.manifest_version).toBe(3);
    ctx.expect(m.permissions).toContain('storage');
  },
};
```

Full guide: [docs/test-framework.md](docs/test-framework.md). End-to-end "did my packaged extension actually boot in Chrome?" tests: [docs/test-boot-layer.md](docs/test-boot-layer.md).

## 🌐 Auto-translation

When you run `npm run build`, @omega.js/extension auto-translates `src/_locales/en/messages.json` to 16 languages via Claude CLI:

`zh`, `es`, `hi`, `ar`, `pt`, `ru`, `ja`, `de`, `fr`, `ko`, `ur`, `id`, `bn`, `tl`, `vi`, `it`

Only missing translations are generated — existing translations are preserved. Full guide: [docs/translations.md](docs/translations.md).

## 🎨 Design tokens (C4)

The cross-target `--omega-*` token contract (defined once in
`@omega.js/web`'s `core/css/tokens/_index.scss`) is vendored into
`dist/assets/css/tokens/` at prepare (package.json `omega.vendorAssets`)
and emitted by the `omega-extension` entry BEFORE the theme — theme rules
override at equal specificity, and component scss can read
`var(--omega-*)` directly. First consumer: `body { accent-color:
var(--omega-accent) }`. The full component migration onto tokens lands
with the C3/D10 skin.

## 🌎 Publishing your extension

### Manual upload

```bash
npm run build
```

Upload the `.zip` files under `packaged/<browser>/` to each browser's extension store.

### Automatic publishing

```bash
OMEGA_IS_PUBLISH=true npm run build
```

Add store credentials to your `.env`:

```bash
# Chrome Web Store
CHROME_EXTENSION_ID="..."
CHROME_CLIENT_ID="..."
CHROME_CLIENT_SECRET="..."
CHROME_REFRESH_TOKEN="..."

# Firefox Add-ons
FIREFOX_EXTENSION_ID="..."
FIREFOX_API_KEY="..."
FIREFOX_API_SECRET="..."

# Microsoft Edge Add-ons
EDGE_PRODUCT_ID="..."
EDGE_CLIENT_ID="..."
EDGE_API_KEY="..."
```

Only stores with configured credentials get published to. Full guide: [docs/publishing.md](docs/publishing.md).

## 🔐 Authentication

@omega.js/extension provides built-in cross-context authentication that syncs across all extension contexts (popup, options, sidepanel, pages, background) without using `chrome.storage`.

**Background.js is the source of truth.** Auth syncs via messaging — sign-in / sign-out events propagate across all open contexts, and new contexts handshake with background on load.

### Setup

1. Set `brand.url` in `config/omega.json5` (background.js watches that host for the /token redirect)
2. Add `tabs` permission to `src/manifest.json`

### Auth button classes

Add these CSS classes to HTML elements for declarative auth UI:

| Class | Action |
|---|---|
| `.omega-signin` | Opens `/token` page on your website |
| `.omega-signout` | Signs out via Web Manager (broadcasts to all contexts) |
| `.omega-account` | Opens `/account` page on your website |

```html
<button class="btn omega-signin" data-omega-bind="@show !auth.user">Sign In</button>

<div data-omega-bind="@show auth.user" hidden>
  <img data-omega-bind="@attr src auth.user.photoURL">
  <span data-omega-bind="@text auth.user.displayName">User</span>
  <button class="omega-account">Account</button>
  <button class="omega-signout">Sign Out</button>
</div>
```

Full guide: [docs/auth.md](docs/auth.md).

## 🔒 Supply-chain security

All `npm install` calls in @omega.js/extension CLI commands (`npx omega setup`, `npx omega install`) route through [Socket Firewall](https://socket.dev/) when installed — blocking confirmed malware at the network level before packages reach disk. Falls back to plain npm if sfw isn't available. Consumer CI workflows (`publish.yml` default) install sfw globally and run `sfw npm install`.

## 📚 Documentation

In-depth docs for every subsystem live in [docs/](docs/); the architecture overview is the framework guide, `docs/extension/index.md` in the omega monorepo.

## 🧰 Sister projects

- [@omega.js/desktop](../desktop/) — same patterns, but for Electron desktop apps
- [Ultimate Jekyll Manager (UJM)](https://github.com/itw-creative-works/ultimate-jekyll-manager) — Jekyll static-site framework
- [Backend Manager (@omega.js/backend)](https://github.com/itw-creative-works/backend-manager) — Firebase Functions backend framework
