/**
 * marketing/stats — the per-item icon and color (#518).
 *
 * Found porting operst: legacy stat rails carried an icon and an accent color
 * per stat, and the band took value + label only, so every stats band on the
 * port dropped both. Items now take an optional `icon` (the ONE icon
 * mechanism) and an optional `color` naming a slot in the categorical token
 * palette — never a raw hex, so a stat can never paint outside the theme.
 * Absent: the band renders exactly what it always did.
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

test('#518: an item with icon and color renders the glyph and the token class', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/stats" %}\nitems:\n'
    + '  - number: "1M+"\n    label: "Happy customers"\n    icon: "smile"\n    color: "tone-3"\n'
    + '{% endsection %}',
    {},
  );

  assert.ok(html.includes('<div class="omega-stat omega-tone-3" data-omega-reveal>'), 'the tone slot rides the stat, from the ONE palette');
  assert.ok(/<span class="omega-icon-chip omega-stat__icon"><i class="fa-solid fa-smile fa-sm"><\/i>/.test(html),
    'the glyph rides the one icon mechanism, in the shared chip idiom');
  assert.ok(html.includes('<div class="omega-stat__num" data-omega-countup>1M+</div>'), 'the number is untouched');
  assert.ok(html.includes('Happy customers'), 'and its label');
  assert.deepEqual(warnings, [], 'icon and color are declared item keys');
});

test('#518: no icon, no color — the band renders exactly what it always did', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/stats" %}\nitems:\n  - number: "99.98%"\n    label: "Uptime"\n{% endsection %}',
    {},
  );

  assert.ok(html.includes('<div class="omega-stat" data-omega-reveal>'), 'the plain stat, class attribute and all');
  assert.ok(!html.includes('omega-stat__icon'), 'no empty icon chip');
  assert.ok(!html.includes('omega-tone-'), 'and no tone class');
  assert.deepEqual(warnings, []);
});

test('#518: a color that is not a palette name paints nothing — no hex ever reaches the markup', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/stats" %}\nitems:\n'
    + '  - number: "3x"\n    label: "Faster"\n    icon: "bolt"\n    color: "#d6336c"\n'
    + '{% endsection %}',
    {},
  );

  assert.ok(html.includes('<div class="omega-stat" data-omega-reveal>'), 'the stat falls back to the theme accent');
  assert.ok(!html.includes('#d6336c'), 'the raw hex never lands in a class, a style, or anywhere else');
  assert.ok(html.includes('fa-bolt'), 'while the icon still renders');
});

test('#518: the gallery variant shows the iconed, toned rail', async () => {
  const pages = await buildWith(miniData, {}, 'stats-args-test');
  const frame = pages.get('/test/sections/marketing/stats/frames/icons-and-tones');
  assert.ok(frame, 'the icons-and-tones variant frame built');

  assert.equal((frame.match(/class="omega-icon-chip omega-stat__icon"/g) || []).length, 4, 'every demo stat carries its glyph');
  assert.ok(frame.includes('omega-tone-1') && frame.includes('omega-tone-4'), 'and its own slot in the ramp');
});
