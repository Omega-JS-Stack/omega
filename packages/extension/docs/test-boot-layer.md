# Test Framework — Boot Layer

The `boot` layer spawns headless Chromium with the **consumer's actual built extension** loaded as unpacked, then runs `inspect` callbacks against the live runtime. Replaces shell-level "did the extension load?" smoke tests with deterministic, signal-driven pass/fail.

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

```js
module.exports = {
  layer: 'boot',
  description: 'extension loads + popup renders',
  timeout: 20000,
  inspect: async ({ extension, page, expect, projectRoot }) => {
    expect(extension.manifest.manifest_version).toBe(3);
    await page.goto(extension.popupUrl, { waitUntil: 'domcontentloaded' });
    const html = await page.content();
    expect(html).toContain('<html');
  },
};
```

Or as a group:

```js
module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'extension boots end-to-end',
  tests: [
    {
      description: 'extension has a valid ID',
      inspect: async ({ extension, expect }) => {
        expect(extension.id).toMatch(/^[a-z]{32}$/);
      },
    },
    {
      description: 'service worker came up',
      inspect: async ({ extension, expect }) => {
        expect(extension.swTarget).not.toBeNull();
      },
    },
  ],
};
```

## The `inspect` callback args

```js
inspect: async ({ extension, page, expect, projectRoot }) => { /* ... */ }
```

| Arg | Type | Description |
|---|---|---|
| `extension.id` | string | The extension's chrome-extension://`<id>` ID — random per launch, 32-char a-z |
| `extension.manifest` | object | Parsed manifest.json |
| `extension.popupUrl` | string\|null | `chrome-extension://<id>/<manifest.action.default_popup>` or null |
| `extension.optionsUrl` | string\|null | `chrome-extension://<id>/<manifest.options_ui.page>` or null |
| `extension.swTarget` | Puppeteer Target | The service worker target (may be null if extension has no SW) |
| `page` | Puppeteer Page | A fresh tab — use `page.goto`, `page.evaluate`, `page.$eval`, etc. |
| `expect` | function | Jest-compatible matcher (same surface as other layers) |
| `projectRoot` | string | Absolute path to the consumer project |

Each boot test gets a **fresh** `page` (closed at the end of the test). The browser + extension load are shared across all boot tests in a single `npx omega test` invocation (one Chromium boot per run, amortized across tests).

## Extension-directory discovery

The runner looks for the consumer's Chrome-loadable build in this order:

1. `OMEGA_TEST_BOOT_DIR` env var (absolute path) — full override
2. `<consumer>/packaged/chromium/raw/` — default. This is what @omega.js/extension's gulp pipeline produces. Strict JSON manifest, all bundles compiled, locale files in place. Same dir a developer points "Load unpacked" at.
3. `<consumer>/dist/` — for non-standard pipelines (and the framework's own fixture extension, which is authored as strict JSON)

**A directory qualifies only when its `manifest.json` is STRICT JSON** — what Chrome can actually parse. Existence alone used to qualify, and the intermediate `<consumer>/dist/` (JSON5, the framework-authored source style) exists after any dev run or `omega clean`, so an unbuilt project loaded that copy and hard-failed every boot test instead of skipping ([#575](https://github.com/Omega-JS-Stack/omega/issues/575)). A JSON5 `dist/` is passed over and named in the skip.

An explicitly named `OMEGA_TEST_BOOT_DIR` is a decision, not a fallback, so a manifest Chrome can't parse THERE is still an actionable failure:

```
✗ boot tests aborted: dist/manifest.json is not strict JSON.
  Chrome requires manifest.json to have no comments, no trailing commas, no single quotes.
  Parser error: Expected property name or '}' in JSON at position 4
  OMEGA_TEST_BOOT_DIR names this directory explicitly — point it at a
  packaged/<browser>/raw/ output, or unset it and run `npm run build`.
```

Most consumers don't need to think about this — `npm run build && npx omega test` works.

## OMEGA_TEST_BOOT_PROJECT vs OMEGA_TEST_BOOT_DIR

| Env | Purpose |
|---|---|
| `OMEGA_TEST_BOOT_PROJECT` | Root of a different project to use instead of cwd. Auto-set when @omega.js/extension tests itself (points at the in-tree fixture under `src/test/fixtures/consumer-extension`). |
| `OMEGA_TEST_BOOT_DIR` | Absolute path of the directory holding `manifest.json` — short-circuits the discovery order entirely. Use for monorepo layouts or custom output dirs. |

## What happens when the extension can't load

Chromium silently rejects extensions with malformed manifests (no chrome-extension:// target ever appears, no error in console). The runner detects this and surfaces likely causes:

```
✗ Boot aborted — Chromium loaded but no chrome-extension target appeared.
  Likely cause: the extension failed to load. Common reasons:
    - manifest.json missing required field (e.g. manifest_version: 3)
    - default_locale is set but _locales/<locale>/messages.json is missing
    - __MSG_*__ placeholders used without default_locale + _locales/
    - referenced files (background.service_worker, content_scripts) don't exist on disk
```

This catches real ship-breakers (broken locale references, missing bundles) before users see them.

## Skipping the build before boot tests

Boot tests assume `packaged/chromium/raw/` exists. They don't auto-trigger `npm run build` (that would slow the test loop). If no candidate carries a strict-JSON manifest, you get:

```
○ boot tests skipped (no strict-JSON manifest.json found in any of:
    /path/to/project/packaged/chromium/raw
    /path/to/project/dist
  /path/to/project/dist/manifest.json exists but is not strict JSON (the intermediate JSON5 source Chrome refuses)
  — run `npm run build` first to produce packaged/chromium/raw/)
```

In CI, run build then test in separate steps so failures are isolated.

## Why this exists

Build-layer tests can verify "the manifest source is well-formed." Background-layer tests can verify "@omega.js/extension's framework code works inside a SW." But neither catches "the consumer's actual pipeline assembles into a Chrome-loadable extension." Boot tests do.

In @omega.js/extension's own self-tests, the boot layer points at a hand-authored fixture extension (`src/test/fixtures/consumer-extension/`) — a known-good minimal MV3 extension. That validates the framework's boot runner is working; consumer projects then point it at their own packaged output to validate THEIR pipeline.

## See also

- [test-framework.md](test-framework.md) — overall harness, layers, ctx, expect API
- [environment-detection.md](environment-detection.md) — `Manager.isTesting()` and friends
