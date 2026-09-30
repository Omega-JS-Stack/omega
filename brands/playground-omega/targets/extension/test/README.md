<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers. OMEGA Extension's test runner discovers files by the directory they sit in:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, manifest validation, pure utilities |
| `test/background/` | MV3 service worker context | Background messaging, auth source-of-truth, alarms |
| `test/view/` | Popup / options / sidepanel page | DOM, view-side controllers, `data-omega-bind` directives |
| `test/boot/` | Consumer's actual built extension | End-to-end smoke tests (does the extension load, does the background register, do views render) |

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

That is the standalone form: one test per file. Every case file wraps its spec in `defineCases` from `@omega.js/extension/test`, so `node --test` on it fails loudly instead of reporting a hollow pass. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library. The `suite`, `group` and array forms, and the `inspect` form the `boot` layer takes, are all in the reference below.

## See also

`node_modules/@omega.js/manager/docs/extension/test-framework.md`: full reference for the test framework (layers, assert API, fixtures, runner internals).

<!-- ========== Custom Values ========== -->
## This project's suites

- `build/notes-background.test.js`: background's notes commands, driven through the real messenger.
- `build/notes-manifest.test.js`: the notes permissions, and the content script held to `brand.url`.
- `boot/notes-count.test.js`: the packaged background answers `notes:count`.
- `boot/options-content.test.js`: the options switch saves the setting, and the content script on the brand site (served by request interception) sends a selection to background.
- `boot/popup-view.test.js`: the packaged popup's signed-out state and its "Open notes" button (the view layer runs the framework's harness pages, so this project's views are tested here).
- `boot/sidepanel-view.test.js`: a real submit in the packaged side panel reaches background and shows its answer.
