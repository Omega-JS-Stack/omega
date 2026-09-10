/**
 * marketing/faq — the superheadline is TEXT, always (Ian's 2026-08-22 ruling,
 * reversing #474).
 *
 * The micro label above the headline carries words and nothing else. An
 * eyebrow authored as `{ icon, text }` is still legal — the icon is simply
 * IGNORED, never an error — so legacy copy keeps rendering its label. Pins:
 * the authored icon dropped on the way in, the text-only head, and the same
 * under the `variant: "center"` presentation since one path serves both.
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

const ITEMS = 'items:\n  - question: "Is there a free tier?"\n    answer: "Yes, free forever for personal projects."\n';

test('an authored superheadline.icon is ignored — the eyebrow renders its label alone', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/faq" %}\nsuperheadline:\n  icon: "circle-question"\n  text: "FAQ"\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<span class="omega-micro">FAQ</span>'), 'the label alone, icon key or not');
  assert.ok(!/<i class="fa-/.test(html), 'no icon markup anywhere in the head');
  assert.ok(!html.includes('<i class="fa'), 'no orphan icon shell');
  assert.ok(!html.includes('[object Object]'), 'never the raw object');
  assert.deepEqual(warnings, [], 'the icon key is ignored, not an error');
});

test('an eyebrow with no icon renders the text-only head, unchanged', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/faq" %}\nsuperheadline:\n  text: "FAQ"\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<span class="omega-micro">FAQ</span>'), 'the label alone, exactly as before');
  assert.ok(!html.includes('<i class="fa'), 'no orphan icon shell');
  assert.deepEqual(warnings, []);
});

test('the centered variant serves the same text-only eyebrow', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/faq" %}\nvariant: "center"\nsuperheadline:\n  icon: "circle-question"\n  text: "FAQ"\n${ITEMS}{% endsection %}`,
    {},
  );

  assert.ok(html.includes('omega-section-head--center'), 'the centered presentation');
  assert.ok(html.includes('<span class="omega-micro">FAQ</span>'), 'with the same bare label in its head');
  assert.ok(!html.includes('data-icon='), 'and no icon, here either');
  assert.deepEqual(warnings, []);
});
