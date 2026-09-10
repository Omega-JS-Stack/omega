# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers — OMEGA Extension's test runner discovers files by the directory they sit in:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, manifest validation, pure utilities |
| `test/background/` | MV3 service worker context | Background messaging, auth source-of-truth, alarms |
| `test/view/` | Popup / options / sidepanel page | DOM, view-side controllers, `data-omega-bind` directives |
| `test/boot/` | Consumer's actual built extension | End-to-end smoke tests (does the extension load, does the background register, do views render) |

## Coverage

Every feature ships with tests at every layer it has a surface in — logic (`build`/`background`), UI (`view`), end-to-end (`boot`). Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the UI test.

Tests that hit REAL external services (Firebase, push, network) are skipped by default — gate them on `process.env.TEST_EXTENDED_MODE` (`if (process.env.TEST_EXTENDED_MODE !== 'true') ctx.skip('extended mode off');`) and run them with `npx omega test --extended` (or `TEST_EXTENDED_MODE=true`). `TEST_EXTENDED_MODE` is the shared, unprefixed name across @omega.js/backend/BXM/UJM/EM. Never mock the external service — skip it in-source.

## Quick example

```js
// test/build/my-feature.test.js
const Manager = require('@omega.js/extension/build');

module.exports = {
  layer: 'build',
  description: 'the project config carries a brand id',
  run: (ctx) => {
    ctx.expect(Manager.getConfig().brand.id).toBeTruthy();
  },
};
```

That is the standalone form: one test per file. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library (there is nothing to require). The `suite`, `group` and array forms, and the `inspect` form the `boot` layer takes, are all in the reference below.

## See also

`node_modules/@omega.js/extension/docs/test-framework.md` — full reference for the test framework (layers, assert API, fixtures, runner internals).
