/**
 * The head cluster's accent, everywhere it has a headline (#471).
 *
 * marketing/bento, marketing/product-demo, marketing/showcase, about/timeline
 * and about/principles rendered a headline but never declared
 * `headline_accent`, so a ported page's split copy warned as unknown and lost
 * its tail — "Everything you" with no accent and no error. This finishes the
 * #436/#439 family: the arg is accepted wherever a headline exists and rides
 * the same <em> mechanism the siblings use. The pricing page's inline FAQ head
 * takes the same forward — pinned in pricing.test.js, where the page builds.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
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

// The five bands that rendered a headline and dropped its accent, each with
// the minimum body that puts the band on the page.
const DROPPERS = [
  ['marketing/bento', 'items:\n  - type: default\n    icon: bolt\n    title: "Fast by default"\n    description: "Static output."\n'],
  ['marketing/product-demo', 'enabled: true\ntabs:\n  - id: "one"\n    label: "Overview"\n    features: ["Fast"]\n'],
  ['marketing/showcase', 'enabled: true\nitems:\n  - title: "One config"\n    description: "Every surface."\n'],
  ['about/timeline', 'items:\n  - year: "2017"\n    title: "The beginning"\n    description: "Day one."\n'],
  ['about/principles', 'items:\n  - title: "Ship it simple"\n    description: "The smallest thing wins."\n'],
];

module.exports = defineCases({
  type: 'group',
  description: 'sections-headline-accent',
  tests: [
    ...(() => {
      const cases = [];
      for (const [name, body] of DROPPERS) {
        cases.push({
          name: `#471: ${name} accepts headline_accent, warn-free`,
          run: async (ctx) => {
            const { engine, warnings } = makeEngine();
            const html = await engine.parseAndRender(
              `{% section "${name}" %}\nheadline: "What builders"\nheadline_accent: "say"\n${body}{% endsection %}`,
              {},
            );

            ctx.expect(html.includes('What builders'), 'headline copy renders').toBeTruthy();
            ctx.expect(html.includes('<em>say</em>'), 'headline_accent rides the same <em> accent mechanism as the siblings').toBeTruthy();
            ctx.expect(warnings, 'ported head copy no longer warns as unknown').toEqual([]);
          },
        });
      }
      return cases;
    })(),

    {
      name: '#471: a band without accent copy renders exactly as it always did',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          `{% section "about/principles" %}\nheadline: "What we stand for"\nitems:\n  - title: "Ship it simple"\n    description: "The smallest thing wins."\n{% endsection %}`,
          {},
        );

        ctx.expect(html.includes('What we stand for'), 'the headline is the whole heading').toBeTruthy();
        ctx.expect(!html.includes('<em>'), 'no empty accent tail without accent copy').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },
  ],
});
