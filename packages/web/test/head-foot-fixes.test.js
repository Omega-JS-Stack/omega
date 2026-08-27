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

  const match = html.match(/<script id="omega-schema-brand"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'brand schema block present');
  const schema = JSON.parse(match[1]);
  assert.equal(schema.description, 'Mini "quoted" \\ brand', 'quote and backslash survive escaping intact');
});

test('W16 (Ian 2026-07-23): synthesized aggregateRating count is seeded into 10k-30k', async () => {
  // `schema` is page MACHINERY, not config (#607): the /download blueprint is
  // the framework surface that switches SoftwareApplication on.
  const pages = await buildWith(miniData, {}, 'head-foot-schema');
  const html = pages.get('/download');

  const match = html.match(/<script id="omega-schema-software-application"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'SoftwareApplication schema block present when enabled');
  const schema = JSON.parse(match[1]);
  const count = Number(schema.aggregateRating.ratingCount);
  assert.ok(count >= 10000 && count < 30000, `ratingCount ${count} inside the seeded 10k-30k band`);
  assert.ok(['4.8', '4.9'].includes(schema.aggregateRating.ratingValue), 'rating value stays 4.8/4.9');
});

test('#606: an unconfigured provider gets NO inline stub — the transport guards every call', async () => {
  // foot.html used to define empty `gtag`/`fbq`/`ttq` when a provider had no
  // id, so #306's guarded wrappers would read a stub as "present". The
  // transport (@omega.js/analytics/transports/browser) checks `typeof` per
  // provider and silently no-ops on a missing global, so the stubs were dead
  // weight that only made a blocked pixel look loaded.
  const pages = await buildWith(miniData, {}, 'head-foot-no-stubs');
  const html = pages.get('/');

  assert.ok(!/function\s+gtag\s*\(/.test(html), 'no gtag stub');
  assert.ok(!/function\s+fbq\s*\(/.test(html), 'no fbq stub');
  assert.ok(!/window\.ttq\s*=/.test(html), 'no ttq stub');
});

test('W13: unconfigured comments never inject the Giscus client script', async () => {
  const pages = await buildWith(miniData);
  const postUrl = [...pages.keys()].find((url) => /^\/blog\/.+/.test(url) && !url.includes('categories'));
  assert.ok(postUrl, 'fixture has a blog post page');
  assert.ok(!pages.get(postUrl).includes('giscus.app/client.js'), 'no giscus injection without comments.giscus.repo');
});

// #251 — the chatsy preconnect gated on `resolved.client.chatsy.enabled`, a key
// nothing writes: the SSOT is `resolved.inbound.chat.providers.chatsy.enabled`
// (foot.html's Configuration blob and @omega.js/client's loader both read it),
// so the hint never fired for any chatsy-enabled brand.
test('#251: the chatsy preconnect follows the inbound.chat SSOT', async () => {
  const chatsy = (enabled) => ({
    ...miniData,
    inbound: { chat: { providers: { chatsy: { enabled, agentId: 'agent-1' } } } },
  });

  const on = await buildWith(chatsy(true), {}, 'head-foot-chatsy-on');
  const html = on.get('/blog');
  assert.ok(html.includes('<link rel="preconnect" href="https://chatsy.ai" crossorigin/>'), 'a chatsy-enabled brand gets the preconnect');
  assert.ok(html.includes('<link rel="dns-prefetch" href="https://chatsy.ai"/>'), 'and the dns-prefetch beside it');

  const off = await buildWith(chatsy(false), {}, 'head-foot-chatsy-off');
  assert.ok(!off.get('/blog').includes('chatsy.ai'), 'a disabled brand emits neither hint');
});

// #271 — every built page shipped one JSON-LD block with `"@type": ""`: the
// brand block's type is `site.brand.type`, a key OMEGA's config never declares
// and the port left without the framework default UJM supplied. Empty-type
// JSON-LD is invalid structured data, and the empty value also flowed into
// every `#<type>` @id anchor the other blocks cross-reference.
test('#271: no built page carries an empty-@type JSON-LD block; the brand block stays valid', async () => {
  const pages = await buildWith(miniData, {}, 'head-foot-schema-type');

  for (const [url, html] of pages) {
    if (!html.includes('application/ld+json')) continue;
    for (const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.ok(!/"@type":\s*""/.test(block[1]), `${url}: no JSON-LD block with an empty @type`);
    }
  }

  const html = pages.get('/blog');
  const brand = JSON.parse(html.match(/<script id="omega-schema-brand"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(brand['@type'], 'Organization', 'a brand with no configured type falls back to Organization');
  assert.equal(brand['@id'], `${miniData.url}#Organization`, 'the @id anchor carries the same type');

  const website = JSON.parse(html.match(/<script id="omega-schema-website"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(website.publisher['@id'], brand['@id'], 'the WebSite block still points at the brand node');
});

// #613: `site.time` was READ by both modified-date surfaces and set by
// nothing, so `article:modified_time` and the JSON-LD `dateModified` shipped
// empty on every page — a search engine reading either got a blank value.
test('#613: site.time is a build fact — both dateModified surfaces render a real xmlschema date', async () => {
  const pages = await buildWith(miniData, {}, 'head-foot-time');
  // Both readers sit inside the POST gate — a post is the page that has a
  // modified date to declare.
  const html = pages.get('/blog/first-post');

  const XMLSCHEMA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/;

  const modified = html.match(/<meta property="article:modified_time" content="([^"]*)"/);
  assert.ok(modified, 'the head still emits article:modified_time');
  assert.match(modified[1], XMLSCHEMA, 'article:modified_time carries the build stamp, not an empty string');

  const posting = JSON.parse(html.match(/<script id="omega-schema-blog"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.match(String(posting.dateModified), XMLSCHEMA, 'the JSON-LD dateModified carries it too');
  assert.equal(posting.dateModified, modified[1], 'ONE stamp per build — the two surfaces can never disagree');

  // …and it is the same instant the rest of the build stamp names.
  assert.ok(
    Math.abs(Date.parse(modified[1]) - Date.now()) < 10 * 60 * 1000,
    'the stamp is this build, not a fixed date baked into a template',
  );
});
