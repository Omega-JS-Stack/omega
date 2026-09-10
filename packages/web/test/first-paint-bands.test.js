/**
 * #467 (Phase 2 checklist): the rest of the first-viewport bands join the
 * marketing hero on the first-paint lane.
 *
 * #749 proved the mechanism on one band (test/hero-first-paint.test.js has the
 * long version): the reveal gate is a SCROLL lane, so the band that IS the
 * first viewport must not sit behind it — `data-omega-first-paint` on the
 * section, and no reveal attributes or stagger container on the copy stack
 * inside it. The #749 worker then found five more bands still gated while
 * being the top of their page:
 *
 *   about/hero          the about page's opening band (both layouts)
 *   frontend/core/minimal   the document masthead (legal, plain-markdown pages)
 *   download.html       the `omega-dl-hero` band
 *   contact.html        the contact masthead
 *   pricing.html        the pricing masthead
 *
 * Four of those compose their copy through `heading/masthead`, which emits the
 * reveal attributes itself, so the component took a `first_paint` switch rather
 * than losing them.
 *
 * The follow-up pass walked the REST of that component's callers (status,
 * feedback, blog and its taxonomy pages, team, legal, alternatives, collection
 * and its category/document pages, extension, updates): every one of them is
 * its page's opening band too, so every one is on the switch now. The
 * component keeps the switch because a mid-page caller — a consumer's own
 * composition, the component gallery — still needs the reveal lane.
 *
 * Below-the-fold content on every one of these pages keeps the reveal lane.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildSite, buildWith, miniData, PKG } = require('./lib/build.js');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const COLLECTIONS = path.join(PKG, 'test', 'fixtures', 'collections-site');
const collectionsData = require(path.join(COLLECTIONS, 'site-data.json'));
const SITE = { site: { brand: { name: 'ACME' } } };

/** Every reveal-lane attribute in the markup, so a failure names what is still gated. */
const revealAttributes = (html) => [...html.matchAll(/data-omega-reveal[\w-]*(?:="[^"]*")?/g)].map((match) => match[0]);

/**
 * The page's OPENING band — the first section inside `<main>`, up to the next
 * one. Anchoring on the main region rather than on `omega-dotgrid` proves the
 * band really is FIRST, and reads the one converted band that wears another
 * shell (the legal document head) the same way. None of these bands nests a
 * section, so the slice is the whole band.
 */
const openingBand = (html) => {
  const main = html.indexOf('<main');
  assert.ok(main !== -1, 'the page renders a main region');
  const at = html.indexOf('<section', main);
  assert.ok(at !== -1, 'and opens on a band');
  const next = html.indexOf('<section', at + 1);
  return html.slice(at, next > -1 ? next : html.length);
};

/** The base theme layer, the way sections-hero.test.js reads it. */
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

// ─── about/hero: the section, both of its layouts ────────────────────────────

const ABOUT_FACTS = 'facts:\n  - number: "2019"\n    label: "Founded"\n  - number: "24"\n    label: "Team members"\n';

test('#467: about/hero paints with the document — the split layout', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "about/hero" %}\nheadline: "We build"\nheadline_accent: "for the long run"\ndescription: "A standfirst under the display headline."\n${ABOUT_FACTS}{% endsection %}`,
    SITE,
  );

  assert.ok(html.includes('omega-display--page'), 'the headline renders');
  assert.ok(html.includes('A standfirst under the display headline.'), 'and the sub line');
  assert.ok(html.includes('Founded'), 'and the facts rail');

  assert.match(html, /<section class="omega-dotgrid[^"]*"[^>]*\sdata-omega-first-paint\b/,
    'the band declares itself a first-paint band');
  assert.deepEqual(revealAttributes(html), [], 'nothing in the band waits on the reveal engine');
  assert.deepEqual(warnings, [], 'renders warn-free');
});

test('#467: about/hero paints with the document — the photo-lead layout', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "about/hero" %}\nheadline: "We build"\nimage: "/assets/images/team.jpg"\nimage_alt: "The team"\ndescription: "A standfirst."\n${ABOUT_FACTS}{% endsection %}`,
    SITE,
  );

  assert.ok(html.includes('omega-photo-lead'), 'the photo lead renders');
  assert.match(html, /<section class="omega-dotgrid[^"]*"[^>]*\sdata-omega-first-paint\b/,
    'the band declares itself a first-paint band');
  assert.deepEqual(revealAttributes(html), [], 'the picture and the words paint together');
  assert.deepEqual(warnings, []);
});

test('#467: a below-the-fold about band keeps the reveal lane exactly as it was', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "about/principles" %}\nitems:\n  - headline: "Ship it"\n    description: "Then improve it."\n{% endsection %}',
    SITE,
  );

  assert.ok(revealAttributes(html).length > 0, 'a scrolled-to band still reveals on scroll-in');
  assert.ok(!html.includes('data-omega-first-paint'), 'and claims no first-paint exemption');
  assert.deepEqual(warnings, []);
});

// ─── The four layouts, through a real build ──────────────────────────────────

test('#467: every first-viewport masthead band paints with the document', async () => {
  const pages = await buildWith(miniData, {}, 'first-paint-bands');

  const bands = [
    // The blueprint about page is the one that composes about/hero (the mini
    // fixture's own /about opens on the marketing hero, #749's band).
    { url: '/about-blueprint', label: 'about/hero through the packaged layout' },
    { url: '/contact', label: 'contact.html' },
    { url: '/pricing', label: 'pricing.html' },
    { url: '/download', label: 'download.html' },
    // A packaged page on frontend/core/minimal that authors a breadcrumb, so
    // the masthead's #491-gated h1 actually renders.
    { url: '/test/libraries/layers', label: 'frontend/core/minimal (the document masthead)' },
  ];

  for (const { url, label } of bands) {
    const page = pages.get(url);
    assert.ok(page, `${label}: ${url} builds`);

    const band = openingBand(page);
    assert.match(band, /^<section[^>]*\sdata-omega-first-paint\b/, `${label}: the opening band declares data-omega-first-paint`);
    assert.deepEqual(revealAttributes(band), [], `${label}: its first-viewport copy carries no reveal attribute`);
    assert.ok(band.includes('<h1'), `${label}: it really rendered the copy stack`);
  }
});

test('#467: below the fold on those same pages, the reveal lane is untouched', async () => {
  const pages = await buildWith(miniData, {}, 'first-paint-bands-below');

  for (const url of ['/contact', '/pricing', '/download']) {
    const page = pages.get(url);
    const band = openingBand(page);
    const below = page.slice(page.indexOf(band) + band.length);

    assert.ok(revealAttributes(below).length > 0, `${url}: the bands the visitor scrolls to still reveal in`);
  }
});

// ─── The rest of the masthead callers ────────────────────────────────────────

test('#467: every remaining masthead band is its page\'s opening band, and paints with it', async () => {
  const pages = await buildWith(miniData, {}, 'first-paint-bands-rest');

  const bands = [
    { url: '/status', label: 'status.html' },
    { url: '/feedback', label: 'feedback.html' },
    { url: '/blog', label: 'blog/index.html' },
    { url: '/blog/tags', label: 'blog/tags/index.html' },
    { url: '/blog/tags/growth-hacks', label: 'blog/tags/tag.html' },
    { url: '/blog/categories', label: 'blog/categories/index.html' },
    { url: '/blog/categories/growth', label: 'blog/categories/category.html' },
    { url: '/team', label: 'team/index.html' },
    { url: '/terms', label: 'legal/document.html' },
    { url: '/alternatives', label: 'alternatives/index.html' },
    { url: '/alternatives/acme-growth', label: 'alternatives/alternative.html' },
    { url: '/extension', label: 'extension/index.html' },
    { url: '/updates', label: 'updates/index.html' },
  ];

  for (const { url, label } of bands) {
    const page = pages.get(url);
    assert.ok(page, `${label}: ${url} builds`);

    const band = openingBand(page);
    assert.match(band, /^<section[^>]*\sdata-omega-first-paint\b/, `${label}: the opening band declares data-omega-first-paint`);
    assert.deepEqual(revealAttributes(band), [], `${label}: its first-viewport copy carries no reveal attribute`);
    assert.ok(band.includes('<h1'), `${label}: it really rendered the copy stack`);
  }
});

test('#467: below the fold on those pages, the reveal lane is untouched', async () => {
  const pages = await buildWith(miniData, {}, 'first-paint-bands-rest-below');

  // /terms is not here on purpose: the legal document body never carried a
  // reveal of its own, so the head band was the layout's only one.
  for (const url of ['/status', '/blog', '/team', '/alternatives', '/extension', '/updates']) {
    const page = pages.get(url);
    const band = openingBand(page);
    const below = page.slice(page.indexOf(band) + band.length);

    assert.ok(revealAttributes(below).length > 0, `${url}: the bands the visitor scrolls to still reveal in`);
  }
});

test("#467: a brand collection's three layouts open on the lane too", async () => {
  // The collection layouts only render for a brand that DECLARED one, so they
  // build through the collections fixture (dynamic-pages.test.js's site).
  const pages = await buildSite(
    COLLECTIONS,
    { ...collectionsData, collections: { docs: { field: 'doc.category', title: 'The Docs', description: 'Everything, written down.' } } },
    {},
    'first-paint-bands-collections',
  );

  const bands = [
    { url: '/docs', label: 'collection/index.html' },
    { url: '/docs/categories/guides', label: 'collection/category.html' },
    { url: '/docs/api', label: 'collection/document.html' },
  ];

  for (const { url, label } of bands) {
    const page = pages.get(url);
    assert.ok(page, `${label}: ${url} builds`);

    const band = openingBand(page);
    assert.match(band, /^<section[^>]*\sdata-omega-first-paint\b/, `${label}: the opening band declares data-omega-first-paint`);
    assert.deepEqual(revealAttributes(band), [], `${label}: its first-viewport copy carries no reveal attribute`);
    assert.ok(band.includes('<h1'), `${label}: it really rendered the copy stack`);
  }
});

// ─── The shared masthead keeps its lane for every other caller ───────────────

test('#467: heading/masthead only drops its reveals when the caller asks', async () => {
  const { engine, warnings } = makeEngine();
  const call = (args) => engine.parseAndRender(`{% component "heading/masthead"${args} %}`, SITE);

  const gated = await call(', eyebrow: "Guides", headline: "Everything about", sub: "A standfirst."');
  assert.deepEqual(
    revealAttributes(gated),
    ['data-omega-reveal', 'data-omega-reveal', 'data-omega-reveal'],
    'a mid-page caller renders the masthead exactly as before — eyebrow, h1, sub',
  );

  const exempt = await call(', eyebrow: "Guides", headline: "Everything about", sub: "A standfirst.", first_paint: true');
  assert.deepEqual(revealAttributes(exempt), [], 'and the switch is what drops them');
  assert.deepEqual(warnings, [], 'both render warn-free');
});
