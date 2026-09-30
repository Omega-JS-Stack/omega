<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers. OMEGA Desktop's test runner discovers files by the directory they sit in:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, config validation, pure utilities |
| `test/main/` | Spawned Electron main process | IPC, storage, windows, anything that needs `app.*` |
| `test/renderer/` | Hidden BrowserWindow | Renderer-side logic, DOM, preload bridge (add `view: '<name>'` to load one of your `src/views/`) |
| `test/boot/` | Consumer's actual built bundle | End-to-end smoke tests (does the app boot, does main show a window, do IPC handlers register) |

A renderer suite that declares `view: '<name>'` runs against that view of YOUR app instead of the framework's harness page: the framework builds the app first, so the page carries your real preload, IPC handlers and config. It rides the boot lane, so `--layer=boot` (or the default `all`) runs it and `--layer=renderer` does not.

## Coverage

Every feature ships with tests at every layer it has a surface in: logic (`build`/`main`), UI (`renderer`), end-to-end (`boot`). Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the UI test.

## Quick example

```js
// test/build/my-feature.test.js
const build = require('@omega.js/desktop/build');
const { defineCases } = require('@omega.js/desktop/test');

module.exports = defineCases({
  layer: 'build',
  description: 'the project config carries a brand id',
  run: (ctx) => {
    ctx.expect(build.getConfig().brand.id).toBeTruthy();
  },
});
```

That is the standalone form: one test per file. Every case file wraps its spec in `defineCases` from `@omega.js/desktop/test`, so `node --test` on it fails loudly instead of reporting a hollow pass. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library. The `suite`, `group` and array forms, and the `inspect` form the `boot` layer takes, are all in the reference below.

## See also

`node_modules/@omega.js/manager/docs/desktop/test-framework.md`: full reference for the test framework (layers, assert API, fixtures, runner internals).

<!-- ========== Custom Values ========== -->
