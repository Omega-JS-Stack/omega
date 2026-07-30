/**
 * Wave-3 head/foot fixes — built-page pins for the shared Liquid:
 *   W8  — og:locale + the language hreflang carry the translation default
 *         (the interpolated variable was never assigned; every page shipped
 *         content="" and an invalid hreflang="").
 *   W11 — config strings interpolated into ld+json are JSON-escaped: a brand
 *         description carrying a double quote still yields parseable schema.
 *   W13 — the Giscus embed is gated on comments.giscus.repo: unconfigured
 *         brands (every scaffold) never inject the client script with an
 *         empty data-repo.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'head-foot-test');

test('W8 + W11: og:locale/hreflang carry the default language; quoted brand strings keep JSON-LD parseable', async () => {
  const pages = await buildWith({
    ...miniData,
    brand: { ...miniData.brand, description: 'Mini "quoted" \\ brand' },
  });
  const html = pages.get('/blog');

  assert.ok(html.includes('property="og:locale" content="en_US"'), 'og:locale carries the Open Graph language_TERRITORY form of the default language');
  assert.ok(!html.includes('property="og:locale" content=""'), 'og:locale never empty');
  assert.ok(!html.includes('hreflang=""'), 'no invalid empty hreflang annotation');

  const match = html.match(/<script id="uj-schema-brand"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'brand schema block present');
  const schema = JSON.parse(match[1]);
  assert.equal(schema.description, 'Mini "quoted" \\ brand', 'quote and backslash survive escaping intact');
});

test('W16 (Ian 2026-07-23): synthesized aggregateRating count is seeded into 10k-30k', async () => {
  const pages = await buildWith({
    ...miniData,
    schema: { software_application: { enabled: true } },
  });
  const html = pages.get('/blog');

  const match = html.match(/<script id="uj-schema-software-application"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'SoftwareApplication schema block present when enabled');
  const schema = JSON.parse(match[1]);
  const count = Number(schema.aggregateRating.ratingCount);
  assert.ok(count >= 10000 && count < 30000, `ratingCount ${count} inside the seeded 10k-30k band`);
  assert.ok(['4.8', '4.9'].includes(schema.aggregateRating.ratingValue), 'rating value stays 4.8/4.9');
});

test('W13: unconfigured comments never inject the Giscus client script', async () => {
  const pages = await buildWith(miniData);
  const postUrl = [...pages.keys()].find((url) => /^\/blog\/.+/.test(url) && !url.includes('categories'));
  assert.ok(postUrl, 'fixture has a blog post page');
  assert.ok(!pages.get(postUrl).includes('giscus.app/client.js'), 'no giscus injection without comments.giscus.repo');
});
