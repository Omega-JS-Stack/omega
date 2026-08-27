/**
 * #515: marketing/prose — the head-plus-lede band.
 *
 * A heading over one or two paragraphs of copy, no items, is one of the most
 * common band shapes there is, and OMEGA had no section for it: the operst port
 * faked it with `marketing/showcase` carrying `enabled: true, items: []`, which
 * happens to render head-only. That accident stays UNRATIFIED; this is the
 * contract. Pins: head plus paragraphs render, an absent body renders the head
 * alone, and the gallery entry ships with its variants.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-prose-test');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const SITE = { site: { brand: { name: 'ACME' } } };

/** Fresh engine over the REAL base theme layer with a captured warn sink. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs: [BASE_THEME], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    site: SITE.site,
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: () => false,
    markdown: (content) => content,
    icons: { fontAwesomeDirs: [], aliasFile: null, flagsDir: null, style: 'solid' },
    logos: { dir: '' },
  });
  return { engine, warnings };
}

/** Every paragraph inside the band's prose column. */
function bodyParagraphs(html) {
  const at = html.indexOf('omega-prose');
  return at === -1 ? [] : (html.slice(at).match(/<p[^>]*>[\s\S]*?<\/p>/g) || []);
}

test('#515: the band renders the head cluster over its body paragraphs', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/prose" %}\n'
    + 'superheadline: "About"\nheadline: "Why we built"\nheadline_accent: "ACME"\n'
    + 'subheadline: "The short version."\n'
    + 'body:\n'
    + '  - "We started because the tooling kept getting in the way."\n'
    + '  - "Ten years later, that is still the whole idea."\n'
    + '{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('<section'), 'the band renders as a full-width section');
  assert.ok(html.includes('<span class="omega-micro">About</span>'), 'the eyebrow rides the shared head cluster');
  assert.ok(html.includes('<h2 class="omega-display omega-display--section">'), 'the head is an h2 beneath the page h1');
  assert.ok(html.includes('Why we built') && html.includes('<em>ACME</em>'), 'headline and accent render');
  assert.ok(html.includes('The short version.'), 'the sub line renders');

  const paragraphs = bodyParagraphs(html);
  assert.strictEqual(paragraphs.length, 2, 'one paragraph per body entry');
  assert.ok(paragraphs[0].includes('the tooling kept getting in the way'), 'first paragraph');
  assert.ok(paragraphs[1].includes('that is still the whole idea'), 'second paragraph, not just the first');
  assert.ok(!html.includes('<img') && !html.includes('<video'), 'no media: this band is words');
  assert.deepEqual(warnings, [], 'every arg is declared — no unknown-arg warning');
});

test('#515: an absent body renders the head alone', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/prose" %}\nheadline: "How it works"\n{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('How it works'), 'the head still renders');
  assert.ok(!html.includes('omega-prose'), 'and no empty prose column under it');
  assert.deepEqual(warnings, []);
});

test('#515: neutral defaults — an unauthored call puts no words on the page', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/prose" %}', SITE);

  assert.ok(!html.includes('<h2'), 'a shared band never speaks for a page it knows nothing about');
  assert.ok(!html.includes('omega-prose'), 'and carries no body of its own');
});

test('#515: the gallery ships the entry and its variants', async () => {
  const pages = await buildWith(miniData);

  const entry = pages.get('/test/sections/section/marketing/prose');
  assert.ok(entry, 'the entry page built');
  assert.ok(entry.includes('body'), 'the args table documents the body arg');

  const full = pages.get('/test/sections/section/marketing/prose/frames/head-and-lede');
  assert.ok(full, 'the Head and lede variant frame built');
  assert.ok(full.includes('omega-prose'), 'with its paragraphs');

  const headOnly = pages.get('/test/sections/section/marketing/prose/frames/head-only');
  assert.ok(headOnly, 'the Head only variant frame built');
  assert.ok(!headOnly.includes('omega-prose'), 'and renders exactly that');
});
