/**
 * The verts/unit section (docs/web/ads-system.md phase 2) — the classy-base
 * fallback-ladder vert band. Pins: context-free markup (host element + data
 * attrs from args, the standard @hide auth binding), neutral mechanical
 * defaults, §7 asset-lane registration (section.js in the main bundle,
 * section.scss on the omega:sections sheet), library resolution, and the
 * source guards that pin the legacy vert.js lane RETIRED (spec sequencing
 * step 5 — the section + shared client verts module are the one implementation).
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

test('verts/unit: args flow to the data-omega-vert vocabulary on the mount host', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "verts/unit", type: "house", size: "banner", vert_id: "promo1", tags: t, section_class: "my-4" %}',
    { t: ['dev', 'news'] },
  );

  assert.ok(html.includes('data-omega-section="verts/unit"'), 'presence-init root');
  assert.ok(html.includes('data-omega-vert="house"'), 'type arg');
  assert.ok(html.includes('data-omega-vert-size="banner"'), 'size arg');
  assert.ok(html.includes('data-omega-vert-id="promo1"'), 'vert_id pin');
  assert.ok(html.includes('data-omega-vert-tags="dev,news"'), 'tags array joins');
  assert.ok(html.includes('class="my-4"'), 'section_class knob');
  assert.ok(html.includes('class="omega-vert-unit"'), 'inner mount host');
  assert.ok(html.includes('data-omega-bind="@hide auth.resolved.active"'), 'paying users hide via the standard binding');
  assert.deepEqual(warnings, []);
});

test('verts/unit: neutral mechanical defaults — display/rectangle, no pins, no tags attr', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender('{% section "verts/unit" %}', {});

  assert.ok(html.includes('data-omega-vert="display"'), 'default type');
  assert.ok(html.includes('data-omega-vert-size="rectangle"'), 'default size');
  assert.ok(!html.includes('data-omega-vert-id'), 'no vert_id attribute without the arg');
  assert.ok(!html.includes('data-omega-vert-tags'), 'no tags attribute without the arg');
  assert.deepEqual(warnings, []);
});

// ─── §7 asset lanes + library resolution ────────────────────────────────────

test('verts/unit: registers both §7 asset lanes from the classy base', () => {
  const assets = collectSectionAssets([CLASSY]);
  const entry = assets.find((item) => item.kind === 'section' && item.id === 'verts/unit');

  assert.ok(entry, 'entry collected');
  assert.ok(entry.js && entry.js.endsWith('_sections/verts/unit/section.js'), 'section.js rides the main bundle');
  assert.ok(entry.scss && entry.scss.endsWith('_sections/verts/unit/section.scss'), 'section.scss rides omega:sections');
});

test('verts/unit: resolves through the library under BOTH themes — newsflash falls through to classy', () => {
  for (const roots of [[CLASSY], [NEWSFLASH, CLASSY]]) {
    const library = buildSectionLibrary({ baseDirs: roots });
    const entry = library.entries.find((item) => item.kind === 'section' && item.id === 'verts/unit');
    assert.ok(entry, `verts/unit resolves over ${roots.length} layer(s)`);
    assert.strictEqual(entry.source, 'classy', 'chips the classy base layer');
  }
});

test('verts/unit: section.js delegates WHOLLY to the shared client verts module (one implementation)', () => {
  const js = fs.readFileSync(path.join(CLASSY, '_sections', 'verts', 'unit', 'section.js'), 'utf8');
  assert.ok(js.includes("from '@omega.js/client'"), 'imports the shared singleton');
  assert.ok(js.includes('omega.verts().mount'), 'delegates lazy-arm + ladder to the client verts module');
  assert.ok(!js.includes('IntersectionObserver'), 'no private lazy fork — the module owns the observer');
  assert.ok(!js.includes('createElement'), 'no DOM construction in the section — the module owns the iframe');
});

// ─── the legacy is retired (step 5) ─────────────────────────────────────────

test('spec step 5 taken: legacy vert.js, popupads.js + adunits includes are GONE', () => {
  for (const relative of ['core/js/modules/vert.js', 'core/js/modules/popupads.js', 'core/_includes/modules/adunits']) {
    assert.ok(!fs.existsSync(path.join(PKG, relative)), `${relative} deleted`);
  }
});

test('no packaged source references the retired legacy lane', () => {
  const roots = ['core', 'defaults', 'themes'].map((dir) => path.join(PKG, dir));
  const offenders = [];

  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (/\.(js|html|scss|json5?|md)$/.test(entry.name)) {
        const contents = fs.readFileSync(full, 'utf8');
        if (/vert\.bundle|adunits\/|popupads/.test(contents)) {
          offenders.push(path.relative(PKG, full));
        }
      }
    }
  };
  roots.forEach(scan);

  assert.deepEqual(offenders, [], 'no vert.bundle/adunits/popupads references remain in packaged layers');
});
