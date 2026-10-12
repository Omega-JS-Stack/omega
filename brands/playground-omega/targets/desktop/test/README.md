<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. The framework auto-runs them alongside its own when you run `npx omega test`.

## Layers

Match the framework's four layers. Each file names its layer (`layer: 'main'`; a file that names none runs on `build`), and the directories below are the convention:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node | Build-time logic, config validation, pure utilities |
| `test/main/` | Spawned Electron main process | IPC, storage, windows, anything that needs `app.*` |
| `test/renderer/` | Hidden BrowserWindow on the framework's harness page | Renderer-side logic, DOM, preload bridge |
| `test/boot/` | Consumer's actual built bundle | End-to-end smoke tests (does the app boot, does main show a window, do IPC handlers register), and your own views |

A boot case is `{ name, run(ctx) }` like every other case; its `ctx` adds `omega` (the live instance), `projectRoot`, `appRoot`, `frameworkDistRoot` and `distSnapshotBefore`. A boot suite that declares `view: '<name>'` runs in that view of YOUR built app, where `ctx.page` is the page's `window`: the framework builds the app first, so the page carries your real preload, IPC handlers and config. `layer: 'renderer'` always means the framework's harness page.

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

That is the standalone form: one test per file. Every case file wraps its spec in `defineCases` from `@omega.js/desktop/test`; run on its own with `node --test`, a `build`-layer file runs its cases, and any other layer registers one failing case naming `npx omega test`. Every `run` receives `ctx`, whose `ctx.expect` is the Jest-compatible assertion library. A `renderer` or `boot` `run` is rebuilt from its text inside the app, so it sees only `ctx` and the globals there, never a closure over the file. The `suite`, `group` and array forms are in the reference below.

## See also

`node_modules/@omega.js/manager/docs/desktop/test-framework.md`: full reference for the test framework (layers, assert API, fixtures, runner internals).

<!-- ========== Custom Values ========== -->
## This project's suites

- `main/notes-ipc.test.js`: main's half of the notes feature (`src/lib/notes.js`) on the harness's real IPC, app store and auth.
- `boot/notes.test.js`: the notes channels, tray item, menu item, context-menu item, deep link and settings window in the real bundle.
- `boot/notes-view.test.js` (`view: 'main'`): the main view's notes panel, driven by real submits and app-store writes.

The real suites beside this file are the worked example: [`build/config.test.js`](build/config.test.js) asserts the identity this project's `config/omega.json5` resolves to, [`boot/app-boots.test.js`](boot/app-boots.test.js) boots the real built bundle and asserts what `src/main.js` and `src/integrations/` wire up, and [`boot/main-view.test.js`](boot/main-view.test.js) (`view: 'main'`) asserts what `src/views/main/` puts on screen.
