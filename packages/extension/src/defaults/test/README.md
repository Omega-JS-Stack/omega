<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers. OMEGA Extension's test runner routes each file by the `layer:` it declares, not by its folder; keep each file in its layer's directory so the tree reads the same way:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, manifest validation, pure utilities |
| `test/background/` | MV3 service worker context | Background messaging, auth source-of-truth, alarms |
| `test/view/` | Your own built view, named by `view: '<name>'` (`views/<name>/index.html` in the packaged extension) | Your popup, options, side panel and pages UI: real events on the real DOM, `data-omega-bind` directives |
| `test/boot/` | Consumer's actual built extension | End-to-end smoke tests (does the extension load, does the background register, do views render) |

A view suite that declares `view: '<name>'` runs against that view of YOUR packaged extension instead of a harness page: it rides the boot lane, which loads your build, so run `npm run build` first. `--layer=boot` (or the default `all`) runs it and `--layer=view` does not.

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

That is the standalone form: one test per file. Every case file wraps its spec in `defineCases` from `@omega.js/extension/test`; run on its own with `node --test`, a `build`-layer file runs its cases, and any other layer registers one failing case naming `npx omega test`. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library. The `suite`, `group` and array forms, and the `inspect` form the `boot` layer takes, are all in the reference below.

## See also

`node_modules/@omega.js/manager/docs/extension/test-framework.md`: full reference for the test framework (layers, assert API, fixtures, runner internals).

<!-- ========== Custom Values ========== -->
