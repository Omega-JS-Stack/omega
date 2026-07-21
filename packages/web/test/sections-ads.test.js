/**
 * The ads/unit section (plans/ads-system.md phase 2) — the classy-base
 * fallback-ladder ad band. Pins: context-free markup (host element + data
 * attrs from args, the standard @hide auth binding), neutral mechanical
 * defaults, §7 asset-lane registration (section.js in the main bundle,
 * section.scss on the omega:sections sheet), library resolution, and the
 * source guards that keep the legacy vert.js lane untouched until its
 * scheduled retirement (spec sequencing step 5).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags, collectSectionAssets, buildSectionLibrary } = require('../src/sections.js');

const PKG = path.resolve(__dirname, '..');
const CLASSY = path.join(PKG, 'themes', 'classy');
const NEWSFLASH = path.join(PKG, 'themes', 'newsflash');

/** Fresh engine over the real classy layer with a captured warn sink. */
function makeEngine(baseDirs = [CLASSY]) {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs, warn: (message) => warnings.push(message) });
  return { engine, warnings };
}

// ─── markup (context-free, args only) ───────────────────────────────────────

test('ads/unit: args flow to the data-omega-ad vocabulary on the mount host', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "ads/unit", type: "house", size: "banner", ad_id: "promo1", tags: t, section_class: "my-4" %}',
    { t: ['dev', 'news'] },
  );

  assert.ok(html.includes('data-omega-section="ads/unit"'), 'presence-init root');
  assert.ok(html.includes('data-omega-ad="house"'), 'type arg');
  assert.ok(html.includes('data-omega-ad-size="banner"'), 'size arg');
  assert.ok(html.includes('data-omega-ad-id="promo1"'), 'ad_id pin');
  assert.ok(html.includes('data-omega-ad-tags="dev,news"'), 'tags array joins');
  assert.ok(html.includes('class="my-4"'), 'section_class knob');
  assert.ok(html.includes('class="omega-ad-unit"'), 'inner mount host');
  assert.ok(html.includes('data-wm-bind="@hide auth.resolved.active"'), 'paying users hide via the standard binding');
  assert.deepEqual(warnings, []);
});

test('ads/unit: neutral mechanical defaults — display/rectangle, no pins, no tags attr', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender('{% section "ads/unit" %}', {});

  assert.ok(html.includes('data-omega-ad="display"'), 'default type');
  assert.ok(html.includes('data-omega-ad-size="rectangle"'), 'default size');
  assert.ok(!html.includes('data-omega-ad-id'), 'no ad_id attribute without the arg');
  assert.ok(!html.includes('data-omega-ad-tags'), 'no tags attribute without the arg');
  assert.deepEqual(warnings, []);
});

// ─── §7 asset lanes + library resolution ────────────────────────────────────

test('ads/unit: registers both §7 asset lanes from the classy base', () => {
  const assets = collectSectionAssets([CLASSY]);
  const entry = assets.find((item) => item.kind === 'section' && item.id === 'ads/unit');

  assert.ok(entry, 'entry collected');
  assert.ok(entry.js && entry.js.endsWith('_sections/ads/unit/section.js'), 'section.js rides the main bundle');
  assert.ok(entry.scss && entry.scss.endsWith('_sections/ads/unit/section.scss'), 'section.scss rides omega:sections');
});

test('ads/unit: resolves through the library under BOTH themes — newsflash falls through to classy', () => {
  for (const roots of [[CLASSY], [NEWSFLASH, CLASSY]]) {
    const library = buildSectionLibrary({ baseDirs: roots });
    const entry = library.entries.find((item) => item.kind === 'section' && item.id === 'ads/unit');
    assert.ok(entry, `ads/unit resolves over ${roots.length} layer(s)`);
    assert.strictEqual(entry.source, 'classy', 'chips the classy base layer');
  }
});

test('ads/unit: section.js delegates WHOLLY to the shared client ads module (one implementation)', () => {
  const js = fs.readFileSync(path.join(CLASSY, '_sections', 'ads', 'unit', 'section.js'), 'utf8');
  assert.ok(js.includes("from '@omega.js/client'"), 'imports the shared singleton');
  assert.ok(js.includes('omega.ads().mount'), 'delegates lazy-arm + ladder to the client ads module');
  assert.ok(!js.includes('IntersectionObserver'), 'no private lazy fork — the module owns the observer');
  assert.ok(!js.includes('createElement'), 'no DOM construction in the section — the module owns the iframe');
});

// ─── the legacy stays put until step 5 ──────────────────────────────────────

test('spec step 5 not taken: legacy vert.js + adunits includes remain untouched', () => {
  for (const relative of ['core/js/modules/vert.js', 'core/_includes/modules/adunits/adsense.html', 'core/_includes/modules/adunits/promo-server.html']) {
    assert.ok(fs.existsSync(path.join(PKG, relative)), `${relative} still present`);
  }
});
