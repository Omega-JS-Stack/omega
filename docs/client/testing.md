# Testing

@omega.js/client's suites are `defineCases` groups under the devkit case runner, one process per file. There is no browser and no jsdom: a hand-rolled preload stands in for the browser globals the modules touch, and every suite drives the real modules from `src/` (or the built `dist/` where it pins the shipped output). The runner's contract (`ctx.expect`, `ctx.after`, suite `setup`/`cleanup`, `--isolation`) is in [docs/devkit/index.md](../devkit/index.md) § Test modules; the pipeline the package sits in is [docs/shared/testing.md](../shared/testing.md).

## Running tests

```bash
npm test                              # prepare, then every suite under test/
node test/storage.test.js             # one file, run on its own
node --test test/storage.test.js      # the same file under node --test
```

`npm test` is `npm run prepare && node --require ./test/setup.js ../devkit/src/test/cli.js --isolation=process`: the build first (some suites read `dist/`), then the runner over `test/`, each `*.test.js` file as the main module of its own child process, so a suite's module-scope state never reaches the next file. The run is teed to `logs/test.log`. A file run on its own registers its cases with `node:test` and runs them right there ([docs/shared/testing.md](../shared/testing.md), "A case file run on its own runs its cases").

## The layout

| File | What it is |
|---|---|
| `test/*.test.js` | The suites: each exports one `defineCases({ type: 'group', description, tests })` group, its cases asserting through `ctx.expect` |
| `test/setup.js` | The `--require` preload: the browser globals as plain objects (`window` with `location`, `screen`, `matchMedia` and in-memory `localStorage`/`sessionStorage`; a minimal `document`; `navigator` with `clipboard` and an inert `serviceWorker`; `URL`, `URLSearchParams`, `self`). Every `addEventListener` call is recorded in `global.__omegaListeners` |
| `test/helpers.js` | The shared harness (below). It requires `setup.js` itself, so a file run on its own gets the globals without the preload |

## The shared Omega instance

`test/helpers.js` exports `TEST_CONFIG` (a config with `environment: 'testing'`, Firebase and Sentry off), `setPathPrefix(prefix)` (stamps the base path on `<html>` and returns the undo), and the four functions behind the one instance a suite shares:

- `createOmega()`: imports `src/index.js` and builds a fresh `Omega`.
- `getOmega()`: returns that instance.
- `clearStorage()`: empties `localStorage` and `sessionStorage`.
- `disposeOmega()`: clears the version-check interval `initialize()` arms, which would otherwise hold the process open.

Every suite that requires the helper wires all three hooks the same way:

```js
const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'storage',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    {
      name: 'Storage Module > should set and get values',
      run: async (ctx) => {
        await beforeEachHook();
        // ...
      },
    },
  ],
});
```

`setup` builds the instance once before the first case, `cleanup` disposes it after the last, and each case opens by clearing storage. A suite that calls `getOmega().initialize(TEST_CONFIG)` does it in its own run-once hook at the top of the cases that need it.

## See also

- [docs/devkit/index.md](../devkit/index.md) § Test modules: the runner, `ctx`, `expect`, isolation
- [docs/shared/testing.md](../shared/testing.md): the tiered pipeline and the `defineCases` rule
