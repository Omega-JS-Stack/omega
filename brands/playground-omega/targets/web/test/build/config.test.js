/**
 * Build layer: this target's config resolves to the playground's identity, and
 * the production build renders a page under it through the brand's theme.
 *
 * @omega.js/config's own suite proves the RESOLVER; what THIS brand declares is
 * hard-coded here, never read back out of the config.
 *
 * Reads dist/, which `omega test` builds before it runs this suite (or run
 * `omega build` first when calling node --test directly).
 *
 * Run (from this target): npx omega test build/config
 */
const { defineCases } = require('@omega.js/web/test');
const fs = require('node:fs');
const path = require('node:path');
const { loadSiteData } = require('@omega.js/web/consumer');

const ROOT = path.join(__dirname, '..', '..');

module.exports = defineCases({
  type: 'group',
  description: 'config',
  tests: [
    {
      name: 'the config resolves this brand, as the web target',
      run: (ctx) => {
        const site = loadSiteData(ROOT);

        ctx.expect(site.brand.id).toBe('playground');
        ctx.expect(site.brand.name).toBe('OMEGA Playground');
        ctx.expect(site.url, 'the subdomain, never the real brand\'s omegajs.dev').toBe('https://playground.omegajs.dev');
        ctx.expect(site.target, 'the folder names the target').toEqual({ name: 'web', type: 'web' });
        ctx.expect(site.theme.id).toBe('classy');
      },
    },

    {
      name: 'the home page renders through the classy theme under the brand name',
      run: (ctx) => {
        const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');

        ctx.expect(html, 'the theme root layout rendered it').toMatch(/data-theme-id=["']?classy/);
        ctx.expect(html, 'with its meta title').toMatch(/<title>OMEGA Playground: see what OMEGA can do<\/title>/);
      },
    },
  ],
});
