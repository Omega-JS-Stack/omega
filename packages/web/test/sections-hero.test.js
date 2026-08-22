/**
 * marketing/hero contract pins — the REAL base section through the real
 * engine: the two CTA buttons obey ONE enabled contract (#438), ported stat
 * `cards` render warn-free (#435), and the `form` demo type renders its field
 * cluster on the framework's own showcase page (#437).
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-hero-test');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const SITE = { site: { brand: { name: 'ACME' } } };

/**
 * Fresh engine over the REAL base theme layer with a captured warn sink —
 * the shipped section.json5 IS the schema under test, so no fixture stands in.
 * Icon roots stay empty: omega_icon emits its `data-icon` placeholder, which
 * is what the assertions read.
 */
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

// ─── #438: one enabled contract for both CTA buttons ─────────────────────────

test('#438: primary_button.enabled false hides it; absent enabled keeps it visible', async () => {
  const { engine, warnings } = makeEngine();
  const hidden = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nprimary_button:\n  enabled: false\n  text: "Start writing free"\n{% endsection %}',
    SITE,
  );
  assert.ok(!hidden.includes('Start writing free'), 'enabled: false suppresses the primary CTA');

  const shown = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nprimary_button:\n  text: "Start writing free"\n{% endsection %}',
    SITE,
  );
  assert.ok(shown.includes('Start writing free'), 'absent enabled keeps the primary CTA (default-visible)');
  assert.deepEqual(warnings, []);
});

// ─── #435: ported stat cards ─────────────────────────────────────────────────

test('#435: hero cards render (count + content) and warn-free — ported stat cards survive', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ncards:\n'
    + '  - number: "99%"\n    label: Undetectable\n    icon: shield-check\n'
    + '  - number: "500K+"\n    label: Pieces created\n    icon: file-lines\n'
    + '  - number: "30+"\n    label: Languages\n'
    + '{% endsection %}',
    SITE,
  );
  assert.equal((html.match(/class="omega-hero__card"/g) || []).length, 3, 'one card per item');
  assert.ok(html.includes('99%') && html.includes('Undetectable'), 'number + label render');
  assert.ok(html.includes('500K+') && html.includes('Pieces created'), 'every item renders, not just the first');
  assert.ok(html.includes('30+') && html.includes('Languages'), 'an icon-less card renders too');
  assert.ok(html.includes('data-icon="shield-check"'), 'optional icon rides the one fa-* mechanism');
  assert.deepEqual(warnings, [], 'cards is a declared arg — no unknown-arg warning');

  const without = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(!without.includes('omega-hero__card'), 'no cards arg renders no card row (brand content, never a theme default)');
});

// ─── #437: the form demo type ────────────────────────────────────────────────

test('#437: demo type "form" renders the field cluster on the shipped showcase page', async () => {
  const pages = await buildWith(miniData);
  const page = pages.get('/test/components/hero-demo-form');
  assert.ok(page, 'hero-demo-form built');

  assert.ok(page.includes('Select industry'), 'select placeholder renders (the issue grep, now positive)');
  assert.ok(page.includes('<select') && page.includes('name="industry"'), 'select field rendered');
  assert.ok(page.includes('<textarea') && page.includes('name="message"'), 'textarea field rendered');
  assert.ok(page.includes('id="hero-demo-form"') && page.includes('data-form-state="initializing"'),
    'the FormManager contract markup rides the form lane');
  assert.ok(page.includes('data-redirect="/contact"'), 'the configurable action rides through');
  assert.ok(page.includes('We respond within 24 hours'), 'subtext still renders under the typed lane');

  // Accessibility: every control labeled, the submit button named.
  assert.ok(page.includes('for="hero-demo-industry"') && page.includes('id="hero-demo-industry"'),
    'select is labelled by a for/id pair');
  assert.ok(page.includes('for="hero-demo-message"') && page.includes('id="hero-demo-message"'),
    'textarea is labelled by a for/id pair');
  assert.ok(/<button type="submit"[^>]*>[\s\S]*?Get quote/.test(page), 'submit button carries its accessible name');
});
