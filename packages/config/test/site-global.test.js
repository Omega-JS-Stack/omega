/**
 * site-global.test.js — toSiteGlobal() shaping of resolved configs.
 */

const test = require('node:test');
const assert = require('node:assert');
const { toSiteGlobal } = require('../src/site-global.js');

test('identity-maps content keys and strips machinery', () => {
  const resolved = {
    brand: { id: 'somiibo', name: 'Somiibo', url: 'https://somiibo.com' },
    theme: { id: 'classy', appearance: 'dark' },
    meta: { title: 'T', description: 'D' },
    analytics: { providers: { google: { id: 'G-1' } } },
    socials: { twitter: 'somiibo' },
    translation: { default: 'en', languages: ['en', 'es'] },
    customKey: { anything: true },
    targets: { web: {}, backend: {} },
    enabled: true,
  };

  const site = toSiteGlobal(resolved);

  assert.strictEqual(site.brand.name, 'Somiibo');
  assert.strictEqual(site.theme.id, 'classy');
  assert.strictEqual(site.socials.twitter, 'somiibo');
  assert.strictEqual(site.customKey.anything, true); // any-key passthrough
  assert.strictEqual(site.targets, undefined); // machinery stripped
  assert.strictEqual(site.enabled, undefined);
});

test('derives url from brand.url with explicit url winning', () => {
  assert.strictEqual(toSiteGlobal({ brand: { url: 'https://a.com' } }).url, 'https://a.com');
  assert.strictEqual(toSiteGlobal({ url: 'https://explicit.com', brand: { url: 'https://a.com' } }).url, 'https://explicit.com');
  assert.strictEqual(toSiteGlobal({}).url, '');
  assert.strictEqual(toSiteGlobal({}).baseurl, '');
  assert.strictEqual(toSiteGlobal({ baseurl: '/sub' }).baseurl, '/sub');
});

test('does not mutate the input config', () => {
  const resolved = { brand: { url: 'https://a.com' }, targets: { web: {} } };
  const before = JSON.stringify(resolved);
  toSiteGlobal(resolved);
  assert.strictEqual(JSON.stringify(resolved), before);
});
