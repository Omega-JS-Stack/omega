<!-- ========== Default Values ========== -->
# Project tests

Drop your project test suites here. `npx omega test` runs a production build, then ONE run of the framework's test runner: the five smoke cases first (every page rendered, a themed 404, the main bundle on disk, every internal link resolving, every page auditing clean), then every `test/**/*.test.js` file here, each in its own process, several at once. One Results block reports them all, and `logs/test.log` holds the run.

## Layers

Match the framework's one layer, `build`. Every suite is a `defineCases` file on it; the directory is a convention, not a layer switch, so keep each file in the directory that names what it tests:

| Directory | Runtime | Use for |
|---|---|---|
| `test/build/` | Plain Node, the `build` layer | Config resolution and the built site in `dist/`: a page renders, carries the right content, links where it should |
| `test/pages/` | Plain Node, the `build` layer | Page modules (`src/assets/js/pages/`): one that imports framework code loads through `loadModule` from `@omega.js/web/test`, with the browser objects it touches passed in |
| `<brandRoot>/test/e2e/` | A real browser against the real local stack | End-to-end: the brand's own browser lane, `defineCases` suite files which `npx omega test` at the brand root runs after every target |

`npx omega test` builds `dist/` before the suites run, so a `build` suite reads it directly; run `npx omega build` first when calling `node --test` on one file. `test/_init.js` runs its `setup()` once before the first case, for a fixture a suite needs. A path narrows the run to the suites whose path contains it: `npx omega test build/config` builds, then runs that suite alone, no smoke case.

## Coverage

Every feature ships with tests at every layer it has a surface in: config and built output (`build`), page logic (`pages`), end-to-end in a real browser (the brand e2e lane). Skip a layer only when the feature genuinely has no surface there; "the logic test covers it" does not excuse the built-output test.

## Quick example

A case file exports its spec through `defineCases`, from the framework's public test API, `@omega.js/web/test`:

```js
// test/build/config.test.js
const { defineCases } = require('@omega.js/web/test');
const path = require('node:path');
const { loadSiteData } = require('@omega.js/web/consumer');

module.exports = defineCases({
  type: 'group',
  description: 'config',
  tests: [
    {
      name: 'the project config carries a brand id',
      run: (ctx) => {
        const site = loadSiteData(path.join(__dirname, '..', '..'));

        ctx.expect(site.brand.id).toBeTruthy();
      },
    },
  ],
});
```

Every check is a `ctx.expect(...)` matcher: `toBe`, `toEqual`, `toBeTruthy`, `toMatch`, `toContain`, `toHaveProperty(path, value?)`, `toThrow`, `expect.fail(message)` and the rest of devkit's set. A helper outside a case body takes the file-level `expect`: `const { defineCases, expect } = require('@omega.js/web/test')`.

Name every file `<concern>.test.js`: the suffix is how the runner finds it, so a helper or fixture under `test/` that does not end in `.test.js`, or sits under a `_`-prefixed name, never runs.

## See also

`node_modules/@omega.js/manager/docs/web/test-framework.md`: full reference for the web test lane (the smoke cases, the exception file, the flags, the scope grammar).

<!-- ========== Custom Values ========== -->
