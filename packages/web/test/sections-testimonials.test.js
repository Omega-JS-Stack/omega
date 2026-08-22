/**
 * marketing/testimonials — the head cluster (#436).
 *
 * The band declared superheadline/items/placeholder and nothing else, so a
 * migrating brand's headline/headline_accent/subheadline copy warned as
 * unknown and was dropped. Pins: the three args render through the shared
 * heading/section-head idiom (same classes, same <em> accent) warn-free, the
 * eyebrow rides the cluster when there IS one, and a band without head copy
 * renders exactly as it always did.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');

const { registerSectionTags } = require('../src/sections.js');

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

const ITEMS = 'items:\n  - quote: "Shipped in a weekend."\n    author: "Avery Quinn"\n    role: "CTO"\n';

test('#436: headline/headline_accent/subheadline render through the section-head idiom, warn-free', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/testimonials" %}\nsuperheadline: "Testimonials"\nheadline: "What builders"\nheadline_accent: "say"\nsubheadline: "Real teams, real ships."\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('class="omega-section-head omega-section-head--center mb-5"'), 'the sibling head shell wraps the cluster');
  assert.ok(html.includes('<h2 class="omega-display omega-display--section">'), 'the shared h2 class');
  assert.ok(html.includes('What builders'), 'headline copy renders');
  assert.ok(html.includes('<em>say</em>'), 'headline_accent rides the same <em> accent mechanism as the siblings');
  assert.ok(html.includes('<p>Real teams, real ships.</p>'), 'subheadline renders');
  assert.deepEqual(warnings, [], 'ported head copy no longer warns as unknown');
});

test('#436: the eyebrow joins the cluster when there is a head, and stays in the quote when there is not', async () => {
  const { engine, warnings } = makeEngine();

  const withHead = await engine.parseAndRender(
    `{% section "marketing/testimonials" %}\nsuperheadline: "Testimonials"\nheadline: "What builders say"\n${ITEMS}{% endsection %}`,
    {},
  );
  assert.ok(withHead.includes('<span class="omega-micro">Testimonials</span>'), 'eyebrow leads the cluster');
  assert.ok(!withHead.includes('omega-micro d-block mb-4'), 'no second eyebrow inside the quote');

  const bare = await engine.parseAndRender(
    `{% section "marketing/testimonials" %}\nsuperheadline: "Testimonials"\n${ITEMS}{% endsection %}`,
    {},
  );
  assert.ok(bare.includes('<span class="omega-micro d-block mb-4">Testimonials</span>'), 'no head copy → the quote label as before');
  assert.ok(!bare.includes('omega-section-head'), 'no empty head shell without head copy');
  assert.deepEqual(warnings, []);
});

test('#436: the { text } superheadline shape still serves the cluster', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/testimonials" %}\nsuperheadline:\n  text: "Loved by teams"\nheadline: "What builders say"\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<span class="omega-micro">Loved by teams</span>'), 'object shape resolves to the same label');
  assert.ok(!html.includes('[object Object]'), 'never the raw object');
  assert.deepEqual(warnings, []);
});
