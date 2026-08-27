/**
 * marketing/bento — the closing CTA and the two superheadline shapes (#439),
 * the neutral subheadline default (#512), linked tiles (#514) and the band's
 * auto-numbering (#519).
 *
 * Migrating a legacy "features" band onto the bento found two contract gaps:
 * the band's closing CTA had no home (it warned as unknown), and the eyebrow
 * took a plain string only, so a legacy `{ icon, text }` flattened to nothing.
 * Pins: cta_button renders in the sibling button idiom and honors the same
 * `enabled` gate hero's secondary button uses, the string eyebrow is
 * untouched, and the object shape renders its text — the micro label is words
 * only, so an authored icon is ignored (Ian's 2026-08-22 ruling).
 *
 * The operst port then found three more: the subheadline default was live
 * demo copy that leaked onto 40 brand pages (#512 — it now lives in the
 * gallery variant, where demo copy belongs), a grid of LINKED cards had no
 * band at all (#514 — a tile with href IS the anchor), and a numbered process
 * band lost its numbers (#519 — band-level `numbered` counts the tiles).
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');

const { registerSectionTags } = require('../src/sections.js');
const { buildWith, miniData } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');
const CORE_ICONS = path.join(PKG, 'core', 'icons');

/** Fresh engine over the real base layer, wired like src/engine.js does. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  const fa = resolveFontAwesomeRoots();
  registerSectionTags(engine, { baseDirs: [BASE], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    icons: {
      fontAwesomeDirs: [CORE_ICONS, ...fa.svgsDirs],
      aliasFile: fa.aliasFile,
      flagsDir: path.join(CORE_ICONS, 'flags'),
      style: 'solid',
    },
  });
  return { engine, warnings };
}

const ITEMS = 'items:\n  - type: default\n    icon: bolt\n    title: "Fast by default"\n    description: "Static output, tuned assets."\n';

test('#439: cta_button renders the closing CTA in the sibling button idiom, warn-free', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/bento" %}\n${ITEMS}cta_button:\n  text: "See every feature"\n  href: "/features"\n{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<a href="/features" class="btn btn-adaptive btn-lg omega-hover-nudge">'), 'the shared closing-CTA button idiom');
  assert.ok(html.includes('See every feature'), 'the button is named by its own copy');
  assert.ok(html.includes('<span class="omega-nudge ms-2"><i class="fa fa-sm" data-icon="arrow-right" aria-hidden="true">'), 'the arrow nudge rides along, hidden from the a11y tree (#538)');
  assert.deepEqual(warnings, [], 'the ported CTA no longer warns as unknown');
});

test('#439: cta_button honors the enabled gate, and absence renders no button at all', async () => {
  const { engine, warnings } = makeEngine();

  const disabled = await engine.parseAndRender(
    `{% section "marketing/bento" %}\n${ITEMS}cta_button:\n  enabled: false\n  text: "See every feature"\n  href: "/features"\n{% endsection %}`,
    {},
  );
  assert.ok(!disabled.includes('See every feature'), 'enabled: false suppresses the CTA');
  assert.ok(!disabled.includes('omega-hover-nudge'), 'no orphan button shell');

  const none = await engine.parseAndRender(`{% section "marketing/bento" %}\n${ITEMS}{% endsection %}`, {});
  assert.ok(!none.includes('omega-hover-nudge'), 'no cta_button → no closing CTA');
  assert.deepEqual(warnings, []);
});

test('#439: superheadline takes BOTH shapes — the string unchanged, the object rendering its text alone', async () => {
  const { engine, warnings } = makeEngine();

  const plain = await engine.parseAndRender(
    `{% section "marketing/bento" %}\nsuperheadline: "Why ACME"\n${ITEMS}{% endsection %}`,
    {},
  );
  assert.ok(plain.includes('<span class="omega-micro">Why ACME</span>'), 'the string form renders exactly as before');

  const object = await engine.parseAndRender(
    `{% section "marketing/bento" %}\nsuperheadline:\n  icon: "rocket"\n  text: "Why ACME"\n${ITEMS}{% endsection %}`,
    {},
  );
  // The superheadline is TEXT, always (Ian's 2026-08-22 ruling): an authored
  // icon is ignored on the way in, never an error. TILE icons are untouched.
  assert.ok(object.includes('<span class="omega-micro">Why ACME</span>'), 'the object form renders its label alone');
  assert.ok(!object.includes('data-icon="rocket"'), 'the authored eyebrow icon is dropped, not rendered');
  assert.ok(object.includes('data-icon="bolt"'), 'while the tile keeps its own feature icon');
  assert.ok(!object.includes('[object Object]'), 'never the raw object');
  assert.deepEqual(warnings, [], 'the object shape carries no type warning');
});

test('#512: an absent subheadline renders NOTHING — no demo line inherited', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(`{% section "marketing/bento" %}\n${ITEMS}{% endsection %}`, {});

  const head = html.slice(0, html.indexOf('omega-bento'));
  assert.ok(!html.includes('A complete foundation'), 'the old demo default is gone from the band');
  assert.ok(!/<p>/.test(head), 'no sub node in the head at all — absence is nothing, not a fallback');
  assert.ok(head.includes('<h2 class="omega-display omega-display--section">'), 'the structural head is untouched');
  assert.deepEqual(warnings, []);
});

test('#512: an authored subheadline still renders its own line', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/bento" %}\nsubheadline: "Eight services, one team."\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<p>Eight services, one team.</p>'), 'the brand\'s own line lands in the head');
});

test('#512: the demo line lives in the gallery variant now', async () => {
  const pages = await buildWith(miniData, {}, 'bento-args-test');
  const frame = pages.get('/test/sections/section/marketing/bento/frames/default-grid');
  assert.ok(frame, 'the default-grid variant frame built');

  assert.ok(frame.includes('A complete foundation that stays out of your way'), 'sample content, where sample content belongs');
});

test('#514: a tile with href IS the anchor — one wrapping link, interactive states, no nested anchor', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/bento" %}\nitems:\n'
    + '  - icon: bolt\n    title: "Solutions"\n    description: "What we build."\n    href: "/solutions"\n'
    + '{% endsection %}',
    {},
  );

  assert.equal((html.match(/<a /g) || []).length, 1, 'exactly ONE anchor — the tile itself, nothing nested');
  assert.ok(/<a href="\/solutions" class="omega-tile[^"]*\bomega-interactive\b[^"]*" data-omega-reveal>/.test(html),
    'the tile wears the shared whole-surface click affordance');
  assert.ok(!html.includes('<div class="omega-tile '), 'no div tile beside the anchor one');
  assert.ok(html.includes('<span class="omega-tile__title">Solutions</span>'), 'the tile body is unchanged inside the link');
  assert.ok(html.includes('<p class="omega-tile__desc">What we build.</p>'), 'description and all');
  assert.deepEqual(warnings, [], 'href is a declared item key — no warning');
});

test('#514: no href — today\'s markup, no anchor, no interactive class', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(`{% section "marketing/bento" %}\n${ITEMS}{% endsection %}`, {});

  assert.ok(html.includes('<div class="omega-tile '), 'the plain tile is the div it has always been');
  assert.ok(!html.includes('<a '), 'no anchor anywhere — no cta_button, no linked tile');
  assert.ok(!html.includes('omega-interactive'), 'and no click affordance on a tile that does not click');
  assert.deepEqual(warnings, []);
});

test('#519: numbered: true counts the tiles 1..N by position', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/bento" %}\nnumbered: true\nitems:\n'
    + '  - title: "Discover"\n    description: "We listen first."\n'
    + '  - title: "Design"\n    description: "Then we draw it."\n'
    + '  - title: "Deliver"\n    description: "Then we ship it."\n'
    + '{% endsection %}',
    {},
  );

  const ordinals = [...html.matchAll(/<span class="omega-tile__ordinal">(\d+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(ordinals, ['1', '2', '3'], 'one ordinal per tile, in composition order');

  const first = html.indexOf('Discover');
  const second = html.indexOf('Design');
  assert.ok(html.indexOf('>1<') < first && first < html.indexOf('>2<') && html.indexOf('>2<') < second,
    'each number rides its own tile');
  assert.deepEqual(warnings, [], 'numbered is a declared band arg');
});

test('#519: an unnumbered band renders no ordinals at all', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(`{% section "marketing/bento" %}\n${ITEMS}{% endsection %}`, {});

  assert.ok(!html.includes('omega-tile__ordinal'), 'the default band is exactly what it was');
});
