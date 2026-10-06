/**
 * The smoke suite every web target runs after its production build. It reads
 * only what the build wrote under the cwd (the target root): `dist/` and
 * `.omega/asset-manifest.json`. A group, so one failed check hides no other.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { linkCheckFailures, auditCheckFailures } = require('../smoke.js');

const target = () => process.cwd();
const dist = () => path.join(target(), 'dist');

// A failing check names every offender in one message.
function failOn(ctx, heading, failures) {
  if (failures.length > 0) ctx.expect.fail(`${heading}:\n  - ${failures.join('\n  - ')}`);
}

module.exports = defineCases({
  type: 'group',
  description: 'smoke',
  tests: [
    {
      name: 'the build wrote pages',
      run: (ctx) => {
        const pages = jetpack.find(dist(), { matching: '*.html' });
        ctx.expect(pages.length, 'build produced no HTML pages in dist/').toBeGreaterThan(0);
      },
    },
    {
      name: '404.html renders through the theme root layout',
      run: (ctx) => {
        const page = jetpack.read(path.join(dist(), '404.html'));
        ctx.expect(page, 'dist/404.html is missing (default pages did not render)').toBeDefined();
        ctx.expect(page, 'dist/404.html did not render through the theme root layout').toContain('data-theme-id');
      },
    },
    {
      name: "the manifest's js.main bundle exists",
      run: (ctx) => {
        const manifest = jetpack.read(path.join(target(), '.omega', 'asset-manifest.json'), 'json');
        ctx.expect(manifest, '.omega/asset-manifest.json is missing').toBeDefined();
        const main = manifest.js && manifest.js.main;
        ctx.expect(main, 'the manifest names no js.main bundle').toBeTruthy();
        ctx.expect(jetpack.exists(path.join(dist(), main.slice(1))), `manifest js.main bundle ${main} is missing from dist/`).toBe('file');
      },
    },
    {
      name: 'every internal link resolves',
      run: (ctx) => failOn(ctx, 'The internal link check failed', linkCheckFailures({ distDir: dist(), targetRoot: target() })),
    },
    {
      name: 'the built output audits clean',
      run: (ctx) => failOn(ctx, 'The built-output audit failed', auditCheckFailures({ distDir: dist(), targetRoot: target() })),
    },
  ],
});
