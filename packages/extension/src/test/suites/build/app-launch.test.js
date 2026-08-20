// Which extension contexts count as a LAUNCH
// ([#386](https://github.com/Omega-JS-Stack/omega/issues/386), stage E of
// [#328](https://github.com/Omega-JS-Stack/omega/issues/328) — inventory gap 7:
// the extension counted nothing about itself).
//
// Three of the four client contexts fire `app_launch`: the toolbar popup, the
// injected page, and the side panel. The OPTIONS page does not — opening
// settings is maintenance, not a launch, and counting it would inflate the
// number with visits that are not sessions with the product (Ian's ruling).
//
// Static, on the SOURCE: the fire is one call in each context's initialize(),
// and there is no cheaper way to prove a context does not make it than reading
// the file the bundle is built from.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..');

/** One context's source, with comments blanked — only what RUNS counts. */
function contextSource(name) {
  return fs.readFileSync(path.join(SRC, `${name}.js`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (match, before) => before + ' '.repeat(match.length - before.length));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'app_launch — the contexts that count as a launch',
  tests: [
    {
      name: 'the popup, the page and the side panel each fire app_launch once',
      run: (ctx) => {
        for (const name of ['popup', 'page', 'sidepanel']) {
          const source = contextSource(name);
          const fires = source.match(/trackAppLaunch\(\)/g) || [];

          ctx.expect(fires.length).toBe(1);
          ctx.expect(source.includes("from './lib/analytics.js'")).toBe(true);
        }
      },
    },
    {
      name: 'the options page fires nothing — settings is not a launch',
      run: (ctx) => {
        const source = contextSource('options');

        ctx.expect(source.includes('trackAppLaunch')).toBe(false);
        ctx.expect(source.includes('./lib/analytics.js')).toBe(false);
      },
    },
    {
      name: 'the launch helper speaks the CANONICAL event, and never throws at a boot',
      run: (ctx) => {
        const helper = fs.readFileSync(path.join(SRC, 'lib', 'analytics.js'), 'utf8');

        // The catalog name, through the shared client — no provider, no dialect.
        ctx.expect(helper.includes("omega.analytics().event('app_launch')")).toBe(true);
        ctx.expect(helper.includes('try {')).toBe(true);
      },
    },
  ],
};
