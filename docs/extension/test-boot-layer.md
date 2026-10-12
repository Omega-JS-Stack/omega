# Test Framework: Boot Layer

The `boot` layer launches headless Chromium with the **consumer's actual built extension** loaded as unpacked, then runs each boot case's `run(ctx)` against the live runtime. Replaces shell-level "did the extension load?" smoke tests with deterministic, signal-driven pass/fail.

## What boot tests verify

Things that ONLY break when the whole pipeline assembles correctly:
- The packaged manifest is valid strict JSON (no JSON5 leakage)
- All referenced files (background.service_worker, content scripts, popup HTML) exist on disk
- The service worker boots without errors
- `chrome.runtime.id` is assigned (extension successfully registered)
- The popup page loads via `chrome-extension://<id>/<popup_path>`
- Messages between popup and background round-trip

If a boot test passes, the extension at minimum *loads* in a real Chrome — that alone catches a class of bugs unit tests can't (missing assets, manifest schema drift, file path typos).

## Test file shape

A boot case is `{ name, run(ctx), timeout?, skip? }`, the same case every layer takes:

```js
const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  type: 'suite',
  layer: 'boot',
  description: 'extension boots end-to-end',
  // A cold first boot of the service worker can run past the 30s default.
  timeout: 45000,
  tests: [
    {
      name: 'extension has a valid ID and an MV3 manifest',
      run: async (ctx) => {
        ctx.expect(ctx.extension.id).toMatch(/^[a-z]{32}$/);
        ctx.expect(ctx.extension.manifest.manifest_version).toBe(3);
      },
    },
    {
      name: 'the popup renders',
      run: async (ctx) => {
        await ctx.page.goto(ctx.extension.popupUrl, { waitUntil: 'domcontentloaded' });
        ctx.expect(await ctx.page.content()).toContain('<html');
      },
    },
  ],
});
```

A boot case runs in the runner process, so its body may `require` what it needs and close over its file.

## The boot `ctx`

Beside the `ctx` every layer gets (`expect`, `waitFor`, `state`, `layer`, `skip`; [test-framework.md](test-framework.md#the-ctx-object)):

| Key | Type | Description |
|---|---|---|
| `ctx.extension.id` | string | The extension's chrome-extension://`<id>` ID: random per launch, 32-char a-z |
| `ctx.extension.manifest` | object | Parsed manifest.json |
| `ctx.extension.popupUrl` | string\|null | `chrome-extension://<id>/<manifest.action.default_popup>` or null |
| `ctx.extension.optionsUrl` | string\|null | `chrome-extension://<id>/<manifest.options_ui.page>` or null |
| `ctx.extension.swTarget` | Puppeteer Target | The service worker target (null when the extension has no SW) |
| `ctx.page` | Puppeteer Page | A fresh tab: use `page.goto`, `page.evaluate`, `page.$eval`, etc. |

Each boot case gets a **fresh** `ctx.page`, closed once the case reports. The browser and the extension load are shared across all boot cases in a single `npx omega test` run (one Chromium boot per run).

**Timeouts.** A case gets the runner's 30000ms unless its suite or itself declares more. The FIRST run after a fresh build initializes the extension's Firebase service worker cold (observed 20-30s), so a boot suite declares `timeout: 45000` at suite level, as the scaffolded suite and the framework's own do ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)).

## Suites that run inside a built view

A suite that declares `layer: 'boot'` and `view: '<name>'`, kept under `test/boot/` with the rest of the boot suites (`test/view/` holds harness-page suites only), runs inside `chrome-extension://<id>/views/<name>/index.html` of this same loaded extension, after the boot cases, in a fresh tab: its bodies travel into the page the way a harness view suite's do, and `ctx.page` is the view's `window`. A view the build does not carry (no `views/<name>/index.html` in the loaded directory) fails every case of the suite naming the file. The knob and its rules are in [test-framework.md](test-framework.md#testing-your-own-views).

## Extension-directory discovery

The runner looks for the consumer's Chrome-loadable build in this order:

1. `OMEGA_TEST_BOOT_DIR` env var (absolute path) — full override
2. `<consumer>/packaged/chrome/raw/`: default. This is what @omega.js/extension's gulp pipeline produces. Strict JSON manifest, all bundles compiled, locale files in place. Same dir a developer points "Load unpacked" at.
3. `<consumer>/dist/` — for non-standard pipelines (and the framework's own fixture extension, which is authored as strict JSON)

**A directory qualifies only when its `manifest.json` is STRICT JSON** — what Chrome can actually parse. Existence alone used to qualify, and the intermediate `<consumer>/dist/` (JSON5, the framework-authored source style) exists after any dev run or `omega clean`, so an unbuilt project loaded that copy and hard-failed every boot test instead of skipping ([#575](https://github.com/Omega-JS-Stack/omega/issues/575)). A JSON5 `dist/` is passed over and named in the skip.

An explicitly named `OMEGA_TEST_BOOT_DIR` is a decision, not a fallback, so a manifest Chrome can't parse THERE is still an actionable failure: every boot case fails with the reason

```
<dir>/manifest.json is not strict JSON (Chrome refuses comments, trailing commas and single quotes: <parser error>). OMEGA_TEST_BOOT_DIR names this directory: point it at a packaged/<browser>/raw/ output, or unset it and run `npm run build`.
```

Most consumers don't need to think about this — `npm run build && npx omega test` works.

## OMEGA_TEST_BOOT_PROJECT vs OMEGA_TEST_BOOT_DIR

| Env | Purpose |
|---|---|
| `OMEGA_TEST_BOOT_PROJECT` | Root of a different project to use instead of cwd. Auto-set when @omega.js/extension tests itself (points at the in-tree fixture under `src/test/fixtures/consumer-extension`). |
| `OMEGA_TEST_BOOT_DIR` | Absolute path of the directory holding `manifest.json` — short-circuits the discovery order entirely. Use for monorepo layouts or custom output dirs. |

## What happens when the extension can't load

Chromium silently rejects extensions with malformed manifests (no chrome-extension:// target ever appears, no error in console). The driver detects this and fails every boot case with the likely causes:

```
Chrome loaded but no chrome-extension target appeared: the extension failed to load. Common reasons: manifest.json misses a required field (manifest_version: 3); default_locale is set but _locales/<locale>/messages.json is missing; __MSG_*__ placeholders are used without default_locale and _locales/; a referenced file (background.service_worker, content_scripts) is not on disk.
```

This catches real ship-breakers (broken locale references, missing bundles) before users see them.

## Skipping the build before boot tests

Boot tests assume `packaged/chrome/raw/` exists. They don't auto-trigger `npm run build` (that would slow the test loop). If no candidate carries a strict-JSON manifest, every boot case reports skipped with the reason

```
no built extension: no strict-JSON manifest.json in /path/to/project/packaged/chrome/raw, /path/to/project/dist; /path/to/project/dist/manifest.json is not strict JSON (the JSON5 source Chrome refuses); run `npm run build` first
```

In CI, run build then test in separate steps so failures are isolated.

## Why this exists

Build-layer tests can verify "the manifest source is well-formed." Background-layer tests can verify "@omega.js/extension's framework code works inside a SW." But neither catches "the consumer's actual pipeline assembles into a Chrome-loadable extension." Boot tests do.

In @omega.js/extension's own self-tests, the boot layer points at a hand-authored fixture extension (`src/test/fixtures/consumer-extension/`), a known-good minimal MV3 extension. That validates the framework's boot driver is working; consumer projects then point it at their own packaged output to validate THEIR pipeline.

## See also

- [test-framework.md](test-framework.md) — overall harness, layers, ctx, expect API
- [environment-detection.md](environment-detection.md): `omega.isTesting()` and friends
