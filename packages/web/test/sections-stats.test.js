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
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'sections-stats',
  tests: [
    {
      name: '#518: an item with icon and color renders the glyph and the token class',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/stats" %}\nitems:\n'
          + '  - number: "1M+"\n    label: "Happy customers"\n    icon: "fa-solid fa-smile"\n    color: "tone-3"\n'
          + '{% endsection %}',
          {},
        );

        ctx.expect(html.includes('<div class="omega-stat omega-tone-3" data-omega-reveal>'), 'the tone slot rides the stat, from the ONE palette').toBeTruthy();
        ctx.expect(/<span class="omega-icon-chip omega-stat__icon"><i class="fa-solid fa-smile fa-sm" aria-hidden="true"><\/i>/.test(html), 'the glyph rides the one icon mechanism, in the shared chip idiom, exactly as authored').toBeTruthy();
        ctx.expect(html.includes('<div class="omega-stat__num" data-omega-countup>1M+</div>'), 'the number is untouched').toBeTruthy();
        ctx.expect(html.includes('Happy customers'), 'and its label').toBeTruthy();
        ctx.expect(warnings, 'icon and color are declared item keys').toEqual([]);
      },
    },

    {
      name: '#518: no icon, no color — the band renders exactly what it always did',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/stats" %}\nitems:\n  - number: "99.98%"\n    label: "Uptime"\n{% endsection %}',
          {},
        );

        ctx.expect(html.includes('<div class="omega-stat" data-omega-reveal>'), 'the plain stat, class attribute and all').toBeTruthy();
        ctx.expect(!html.includes('omega-stat__icon'), 'no empty icon chip').toBeTruthy();
        ctx.expect(!html.includes('omega-tone-'), 'and no tone class').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#518: a color that is not a palette name paints nothing — no hex ever reaches the markup',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/stats" %}\nitems:\n'
          + '  - number: "3x"\n    label: "Faster"\n    icon: "fa-solid fa-bolt"\n    color: "#d6336c"\n'
          + '{% endsection %}',
          {},
        );

        ctx.expect(html.includes('<div class="omega-stat" data-omega-reveal>'), 'the stat falls back to the theme accent').toBeTruthy();
        ctx.expect(!html.includes('#d6336c'), 'the raw hex never lands in a class, a style, or anywhere else').toBeTruthy();
        ctx.expect(html.includes('fa-bolt'), 'while the icon still renders').toBeTruthy();
      },
    },

    {
      name: '#518: the gallery variant shows the iconed, toned rail',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'stats-args-test');
        const frame = pages.get('/test/sections/marketing/stats/frames/icons-and-tones');
        ctx.expect(frame, 'the icons-and-tones variant frame built').toBeTruthy();

        ctx.expect((frame.match(/class="omega-icon-chip omega-stat__icon"/g) || []).length, 'every demo stat carries its glyph').toBe(4);
        ctx.expect(frame.includes('omega-tone-1') && frame.includes('omega-tone-4'), 'and its own slot in the ramp').toBeTruthy();
      },
    },
  ],
});
