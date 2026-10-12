<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers. OMEGA Extension's test runner routes each file by the `layer:` it declares, not by its folder; keep each file in the directory of what it tests so the tree reads the same way:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, manifest validation, pure utilities |
| `test/background/` | MV3 service worker context | Background messaging, auth source-of-truth, alarms |
| `test/view/` | A page of the framework's harness extension (`layer: 'view'`, `context: 'popup'`, `'options'` or `'sidepanel'`) | The `omega` surface and @omega.js/client in a bare page, never your own UI |
| `test/boot/` | Consumer's actual built extension | End-to-end smoke tests (does the extension load, does the background register), and your own views: `layer: 'boot'` plus `view: '<name>'` (`views/<name>/index.html` in the packaged extension), real events on the real DOM, `data-omega-bind` directives |

A suite under `test/boot/` that declares `layer: 'boot'` and `view: '<name>'` runs inside that view of YOUR packaged extension, where `ctx.page` is the view's `window`; the boot layer loads your build, so run `npm run build` first. `layer: 'view'` always means the framework's harness page. A boot case is `{ name, run(ctx) }` like any other, with `ctx.extension` (id, manifest, popup and options URLs) and a fresh Puppeteer `ctx.page`; a boot suite declares `timeout: 45000`, since a cold first boot can pass the 30s default.

## Coverage

Every feature ships with tests at every layer it has a surface in: logic (`build`/`background`), UI (`view`), end-to-end (`boot`). Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the UI test.

Tests that hit REAL external services (Firebase, push, network) are skipped by default. Gate them on `process.env.TEST_EXTENDED_MODE` (`if (process.env.TEST_EXTENDED_MODE !== 'true') ctx.skip('extended mode off');`) and run them with `npx omega test --extended` (or `TEST_EXTENDED_MODE=true`). `TEST_EXTENDED_MODE` is the shared, unprefixed name across every OMEGA framework (@omega.js/backend, @omega.js/extension, @omega.js/web, @omega.js/desktop). Never mock the external service: skip it in-source.

## Quick example

```js
// test/build/my-feature.test.js
const build = require('@omega.js/extension/build');
const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  layer: 'build',
  description: 'the project config carries a brand id',
  run: (ctx) => {
    ctx.expect(build.getConfig().brand.id).toBeTruthy();
  },
});
```

That is the standalone form: one test per file. Every case file wraps its spec in `defineCases` from `@omega.js/extension/test`; run on its own with `node --test`, a `build`-layer file runs its cases, and any other layer registers one failing case naming `npx omega test`. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library. The `suite`, `group` and array forms are in the reference below.

## See also

`node_modules/@omega.js/manager/docs/extension/test-framework.md`: full reference for the test framework (layers, assert API, fixtures, runner internals).

<!-- ========== Custom Values ========== -->
## This project's suites

- `build/notes-background.test.js`: background's notes commands, driven through the real messenger.
- `boot/notes-count.test.js`: the packaged background answers `notes:count`.
- `boot/notes-manifest.test.js`: the packaged manifest's notes permissions, and its content script match compiled to the `brand.url` origin.
- `boot/options-content.test.js`: the options switch saves the setting, and the content script on the brand site (served by request interception) sends a selection to background.
- `boot/popup.test.js`: the popup's signed-out state and its "Open notes" button.
- `boot/sidepanel.test.js`: a real submit in the side panel reaches background and shows its answer.

A restarted worker answering a signed-in `notes:count` from its own restored session is proven against the real emulator by the monorepo's root extension auth lane (`npm run test:e2e-extension`), not by a suite here.
