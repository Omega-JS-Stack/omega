// Which extension contexts count as a LAUNCH
// ([#386](https://github.com/Omega-JS-Stack/omega/issues/386), stage E of
// [#328](https://github.com/Omega-JS-Stack/omega/issues/328), inventory gap 7:
// the extension counted nothing about itself).
//
// Three of the four page contexts fire `app_launch`: the toolbar popup, the
// injected page, and the side panel. The OPTIONS page does not: opening
// settings is maintenance, not a launch, and counting it would inflate the
// number with visits that are not sessions with the product (Ian's ruling).
//
// The four page contexts are ONE class (src/page-context.js), which calls
// trackAppLaunch(this) once; lib/analytics.js decides by the context name. The
// helper imports nothing, so it is loaded and driven for real here.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC = path.join(__dirname, '..', '..', '..');
const ANALYTICS = pathToFileURL(path.join(SRC, 'lib', 'analytics.js')).href;

/** A page context's launch surface: its name, and the events its analytics sent. */
function makeContext(context) {
  const events = [];
  return { events, omega: { context, analytics: { event: (name) => events.push(name) } } };
}

/** The page class's source, with comments blanked: only what RUNS counts. */
function pageContextSource() {
  return fs.readFileSync(path.join(SRC, 'page-context.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (match, before) => before + ' '.repeat(match.length - before.length));
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'app_launch: the contexts that count as a launch',
  tests: [
    {
      name: 'the popup, the page and the side panel each fire app_launch once',
      run: async (ctx) => {
        const { trackAppLaunch } = await import(ANALYTICS);

        for (const name of ['popup', 'page', 'sidepanel']) {
          const { events, omega } = makeContext(name);
          trackAppLaunch(omega);
          ctx.expect(events).toEqual(['app_launch']);
        }
      },
    },
    {
      name: 'the options page fires nothing: settings is not a launch',
      run: async (ctx) => {
        const { trackAppLaunch, LAUNCH_CONTEXTS } = await import(ANALYTICS);
        const { events, omega } = makeContext('options');

        trackAppLaunch(omega);

        ctx.expect(events).toEqual([]);
        ctx.expect(LAUNCH_CONTEXTS.includes('options')).toBe(false);
      },
    },
    {
      name: 'a failing analytics never throws at a boot',
      run: async (ctx) => {
        const { trackAppLaunch } = await import(ANALYTICS);
        const omega = { context: 'popup', analytics: { event: () => { throw new Error('transport down'); } } };

        ctx.expect(() => trackAppLaunch(omega)).not.toThrow();
      },
    },
    {
      name: 'the page class fires it exactly once, after the client boots',
      run: (ctx) => {
        const source = pageContextSource();

        ctx.expect((source.match(/trackAppLaunch\(this\)/g) || []).length).toBe(1);
        ctx.expect(source.includes("from './lib/analytics.js'")).toBe(true);
        ctx.expect(/await super\.initialize\([^)]*\);[\s\S]*trackAppLaunch\(this\);/.test(source)).toBe(true);
      },
    },
  ],
});
