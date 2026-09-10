// The syntax floor the browser bundles compile to, READ from the manifest
// ([#738](https://github.com/Omega-JS-Stack/omega/issues/738)).
//
// @babel/preset-env guessed a floor from its own browserslist tables; esbuild's
// `target` states it, and the project already declares it in the one place a
// browser reads: `minimum_chrome_version` and
// `browser_specific_settings.gecko.strict_min_version`. A consumer that raises
// either must move the bundler with it — a hardcoded pair would keep compiling
// for browsers the extension no longer supports (and, worse, would not compile
// down for a floor the consumer LOWERED).
//
// The two fallbacks are the MV3 minimums, and they are the only constants: an
// extension declaring nothing still cannot load below them.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const task = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'));

// The list webpack's `resolve.fallback` carried, verbatim — the browser answer
// to Node built-ins a bundled library imports on paths it never runs.
const RESOLVE_FALLBACK = ['fs', 'path', 'crypto', 'os', 'util', 'assert', 'stream', 'buffer', 'process'];

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'bundle targets — the syntax floor is read from the manifest, with the MV3 minimums as the floor',
  tests: [
    {
      name: 'a manifest declaring no floors takes the MV3 minimums',
      run: (ctx) => {
        ctx.expect(task.resolveSyntaxTarget({})).toEqual(['chrome88', 'firefox91']);
      },
    },

    {
      name: "a declared gecko strict_min_version IS the firefox floor",
      run: (ctx) => {
        const manifest = { browser_specific_settings: { gecko: { strict_min_version: '115.0' } } };
        ctx.expect(task.resolveSyntaxTarget(manifest)).toEqual(['chrome88', 'firefox115']);
      },
    },

    {
      name: 'a declared minimum_chrome_version IS the chrome floor',
      run: (ctx) => {
        ctx.expect(task.resolveSyntaxTarget({ minimum_chrome_version: '110' })).toEqual(['chrome110', 'firefox91']);
      },
    },

    {
      name: 'a floor that is not a version is ignored — the minimum stands rather than an invented target',
      run: (ctx) => {
        ctx.expect(task.resolveSyntaxTarget({ minimum_chrome_version: 'latest' })).toEqual(['chrome88', 'firefox91']);
      },
    },

    {
      name: 'the browser Node-builtin shim list is the resolve.fallback list webpack carried',
      run: (ctx) => {
        ctx.expect(task.BROWSER_EMPTY_MODULES).toEqual(RESOLVE_FALLBACK);
      },
    },
  ],
});
