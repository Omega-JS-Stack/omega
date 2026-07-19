/**
 * C4 cp105 — advertising is role-keyed config, zero ITW hardcodes.
 *
 * Two halves: the packaged sources speak `advertising.providers.*` with no
 * baked-in ITW ad-server values (vert.js reads the inhouse provider from
 * config), and the engine renders ad units from the config channel — present
 * when a client id is configured, absent when not.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'ads-test');

// ─── Source guards ───────────────────────────────────────────────────────────

test('vert.js carries zero ITW hardcodes and reads the inhouse provider from config', () => {
  const vert = fs.readFileSync(path.join(PKG, 'core', 'js', 'modules', 'vert.js'), 'utf8');

  assert.ok(!vert.includes('itwcreativeworks'), 'no ITW ad-server hostname baked in');
  assert.ok(!vert.includes("brand.id === 'promo-server'"), 'no brand-id special case');
  assert.ok(vert.includes('advertising?.providers?.inhouse?.serverUrl'), 'inhouse server comes from config');
  assert.ok(vert.includes('allowedOrigins'), 'message origins derive from config, not a literal');
});

test('packaged content speaks advertising.providers.* only', () => {
  const files = [
    ['core/_includes/modules/adunits/adsense.html', 'advertising.providers.google-adsense'],
    ['core/_includes/core/head.html', 'advertising.providers.google-adsense.client'],
    ['core/js/pages/blog/[slug].js', "advertising?.providers?.['google-adsense']"],
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
    inhouse: { serverUrl: 'https://ads.example.com' },
  },
};

test('configured advertising renders the ad unit from config values', async () => {
  const pages = await buildWith({ ...miniData, advertising: ADVERTISING });
  const html = pages.get('/ad');

  assert.ok(html.includes('ca-pub-TEST123'), 'client id flows from config');
  assert.ok(html.includes('"data-ad-slot": "9990001"'), 'in-article slot flows from config');
  assert.ok(html.includes('"data-ad-type": "in-article"'), 'ad TYPE param drives the unit');
});

test('no advertising config → no ad unit markup at all', async () => {
  const pages = await buildWith(miniData);
  const html = pages.get('/ad');

  assert.ok(html.includes('id="ad-page"'), 'page itself renders');
  assert.ok(!html.includes('data-ad-client'), 'no ad unit without a configured client');
});
