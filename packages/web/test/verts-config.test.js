/**
 * C4 cp105 (reshaped at ads step 5) — advertising is role-keyed config,
 * zero ITW hardcodes.
 *
 * Two halves: the packaged sources speak `advertising.providers.*` with no
 * baked-in ITW ad-server values (blog [slug].js gates on config presence and
 * delegates to the shared client verts module), and the engine renders the
 * verts/unit section from CONFIG-FREE markup — client ids and slots never
 * reach the page; the client module reads them at mount.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'verts-test');

// ─── Source guards ───────────────────────────────────────────────────────────

test('blog [slug].js rides the modern verts lane — config-gated, module-delegated', () => {
  const slug = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'blog', '[slug].js'), 'utf8');

  assert.ok(!slug.includes('itwcreativeworks'), 'no ITW ad-server hostname baked in');
  assert.ok(!slug.includes('vert.bundle'), 'no legacy vert bundle reference');
  assert.ok(slug.includes('omega.config?.advertising'), 'advertising key presence gates insertion');
  assert.ok(slug.includes('data-omega-vert'), 'inserted hosts speak the modern vocabulary');
  assert.ok(slug.includes('omega.verts().mount'), 'delegates the lifecycle to the shared client verts module');
});

test('packaged content speaks advertising.providers.* only', () => {
  const files = [
    ['core/_includes/core/head.html', 'advertising.providers.google-adsense.client'],
  ];

  for (const [relative, marker] of files) {
    const contents = fs.readFileSync(path.join(PKG, relative), 'utf8');
    assert.ok(contents.includes(marker), `${relative} reads the providers path`);
    assert.ok(!/advertising\.google-adsense|advertising\?\.\['google-adsense'\]/.test(contents), `${relative} has no pre-providers spelling`);
  }
});

// ─── Engine channel ──────────────────────────────────────────────────────────

const ADVERTISING = {
  providers: {
    'google-adsense': {
      client: 'ca-pub-TEST123',
      'in-article-slot': '9990001',
    },
    inhouse: { source: 'self' },
  },
};

test('configured advertising: the verts/unit section renders its host — values stay in config', async () => {
  const pages = await buildWith({ ...miniData, advertising: ADVERTISING });
  const html = pages.get('/vert');

  assert.ok(html.includes('data-omega-vert="in-article"'), 'section host renders with the type');
  // The id/slot reach the page ONLY through the baked window.Configuration
  // (the channel the client verts module reads) — never as legacy unit markup
  assert.ok(!html.includes('data-ad-client'), 'no legacy data-ad-* unit markup');
  assert.ok(!html.includes('vert.bundle'), 'no legacy vert bundle script');
});

test('no advertising config: markup is identical — enablement is client-side key presence', async () => {
  const pages = await buildWith(miniData);
  const html = pages.get('/vert');

  assert.ok(html.includes('id="vert-page"'), 'page itself renders');
  assert.ok(html.includes('data-omega-vert="in-article"'), 'the host still renders (the module no-fills without config)');
  assert.ok(!html.includes('data-ad-client'), 'no legacy ad unit markup');
});
