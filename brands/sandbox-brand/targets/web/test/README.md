<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. `npx omega test` runs a production build, smoke-checks it (every page rendered, every internal link resolving, every page auditing clean), then runs every `test/**/*.test.js` file here with `node --test`.

## Layers

Match the framework's layers. Every suite is a plain `node --test` file, and the directory it sits in names its layer:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node, after the production build | Config resolution and the built site in `dist/`: a page renders, carries the right content, links where it should |
| `test/pages/` | Plain Node | Page modules (`src/assets/js/pages/`), imported directly, with the browser objects they touch passed in |
| `<brandRoot>/test/e2e/run.js` | A real browser against the real local stack | End-to-end: the brand's own browser lane, which `npx omega test` at the brand root runs after every target |

`npx omega test` builds `dist/` before the suites run, so a `build` suite reads it directly; run `npx omega build` first when calling `node --test` on one file. `test/_init.js` runs its `setup()` once before the suites, for a fixture a suite needs.

## Coverage

Every feature ships with tests at every layer it has a surface in: config and built output (`build`), page logic (`pages`), end-to-end in a real browser (the brand e2e lane). Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the built-output test.

## Quick example

```js
// test/build/config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSiteData } = require('@omega.js/web/consumer');

test('the project config carries a brand id', () => {
  const site = loadSiteData(path.join(__dirname, '..', '..'));

  assert.ok(site.brand.id);
});
```

Name every file `<concern>.test.js`: the suffix is how the runner finds it, so a helper or fixture under `test/` that does not end in `.test.js` never runs. There is no case wrapper and no `ctx`: web suites are plain `node --test` files over a real build.

## See also

`node_modules/@omega.js/manager/docs/web/test-framework.md`: full reference for the web test lane (the smoke checks, the exception file, the scope grammar).

<!-- ========== Custom Values ========== -->
