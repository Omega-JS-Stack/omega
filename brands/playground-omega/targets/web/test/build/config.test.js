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
 *   node --test test/build/config.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadSiteData } = require('@omega.js/web/consumer');

const ROOT = path.join(__dirname, '..', '..');

test('the config resolves this brand, as the web target', () => {
  const site = loadSiteData(ROOT);

  assert.equal(site.brand.id, 'playground');
  assert.equal(site.brand.name, 'OMEGA Playground');
  assert.equal(site.url, 'https://playground.omegajs.dev', 'the subdomain, never the real brand\'s omegajs.dev');
  assert.deepEqual(site.target, { name: 'web', type: 'web' }, 'the folder names the target');
  assert.equal(site.theme.id, 'classy');
});

test('the home page renders through the classy theme under the brand name', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');

  assert.match(html, /data-theme-id=["']?classy/, 'the theme root layout rendered it');
  assert.match(html, /<title>OMEGA Playground: see what OMEGA can do<\/title>/, 'with its meta title');
});
