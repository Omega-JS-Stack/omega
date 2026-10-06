/**
 * App-chrome action sizing + the topbar's own icon.
 *
 * #43: Liquid's `.size` on a hash is its KEY COUNT, not a missing property —
 * `{% if action.size %}` therefore fired for EVERY action and stamped a
 * `btn-<keycount>` class. The templates test the value explicitly now, so an
 * action with no size renders no size class at all.
 *
 * #3: the rail-collapse control asked for a `sidebar` icon the chain cannot
 * resolve; stock chrome must render a real SVG, never the tagged fallback.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { buildSite } = require('./lib/build.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'topbar-site');
const topbarData = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'site-data.json'), 'utf8'));

const buildApp = async () => {
  const pages = await buildSite(FIXTURE, topbarData, {}, 'app-actions-test');
  const app = pages.get('/app');
  expect(app, 'app surface built').toBeTruthy();
  return app;
};

module.exports = defineCases({
  type: 'group',
  description: 'app-actions',
  tests: [
    {
      name: '#43: an action with no size renders NO size class — the btn-<keycount> trap is gone',
      run: async (ctx) => {
        const app = await buildApp();

        ctx.expect(!/\bbtn-\d/.test(app), 'no numeric btn-<N> class anywhere in the chrome').toBeTruthy();
        ctx.expect(app.includes('Unsized action'), 'the topbar action rendered').toBeTruthy();
        ctx.expect(app.includes('Unsized header action'), 'the page-header action rendered').toBeTruthy();
        ctx.expect(app.includes('Unsized dropdown'), 'the topbar dropdown action rendered').toBeTruthy();
        ctx.expect(app.includes('Unsized header dropdown'), 'the page-header dropdown action rendered').toBeTruthy();
      },
    },

    {
      name: '#43: size: lg still renders btn-lg — and no longer collides with the btn-sm default',
      run: async (ctx) => {
        const app = await buildApp();

        const large = app.match(/<a class="([^"]*)" href="\/large"/g) || [];
        ctx.expect(large.length, 'both the topbar and the page-header large actions rendered').toBe(2);
        for (const anchor of large) {
          ctx.expect(anchor, 'the authored size lands as btn-lg').toMatch(/btn-lg/);
          ctx.expect(!/btn-sm/.test(anchor), 'the small default steps aside for an authored size').toBeTruthy();
        }

        const unsized = app.match(/<a class="([^"]*)" href="\/unsized"/g) || [];
        ctx.expect(unsized.length, 'both unsized actions rendered').toBe(2);
        for (const anchor of unsized) {
          ctx.expect(!/btn-lg/.test(anchor), 'an unsized action never borrows a size').toBeTruthy();
        }
      },
    },

    {
      name: '#3: the stock app chrome resolves every icon — no fallback triangle, no missing tag',
      run: async (ctx) => {
        const app = await buildApp();

        ctx.expect(!app.includes('data-omega-icon-missing'), 'no icon fell through to the empty marker').toBeTruthy();
        ctx.expect(app.includes('data-omega-fa="solid/table-columns"'), 'the rail-collapse toggle wears a resolvable icon').toBeTruthy();
        ctx.expect(!app.includes('fa-sidebar'), 'the unresolvable name is gone').toBeTruthy();
      },
    },
  ],
});
