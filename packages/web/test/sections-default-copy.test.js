/**
 * #512 sweep — a section default is a STRUCTURE default, never live demo copy
 * a brand's own band inherits. The bug came in through `marketing/bento`
 * (pinned in sections-bento.test.js); the same pattern sat on the two about
 * bands, whose demo sub lines leaked onto any band a page authored without
 * one. Their copy moved to the gallery variants, where sample content
 * belongs, and an absent sub line now renders NOTHING.
 *
 * The about layout authors both bands' real sub lines itself, so the packaged
 * /about page is unchanged — that half is pinned by the about page tests.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');

const { registerSectionTags } = require('../src/sections.js');
const { buildWith, miniData } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');

/** Fresh engine over the real base layer with a captured warn sink. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs: [BASE], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    site: { brand: { name: 'ACME' } },
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: () => false,
    markdown: (content) => content,
    icons: { fontAwesomeDirs: [], aliasFile: null, flagsDir: null, style: 'solid' },
    logos: { dir: '' },
  });
  return { engine, warnings };
}

const SWEPT = [
  {
    id: 'about/timeline',
    body: 'items:\n  - year: "2024"\n    title: "Founded"\n    description: "Two people, one room."\n',
    leaked: 'The moments that shaped how we work.',
    frame: '/test/sections/about/timeline/frames/default-journey',
  },
  {
    id: 'about/principles',
    body: 'items:\n  - title: "Ship it simple"\n    description: "The smallest thing that solves it wins."\n',
    leaked: 'Our working principles, in order.',
    frame: '/test/sections/about/principles/frames/default-principles',
  },
];

/**
 * #530 — the sweep remainder: the three marketing bands the packaged homepage
 * composes WITHOUT copy of its own, so a demo sub line in their defaults is
 * the leak in its purest form. Same rule, same shape: the default is empty,
 * the demo line lives in each band's gallery variant.
 */
const SWEPT_530 = [
  {
    id: 'marketing/showcase',
    // Off by default (a family gate), so the band has to be switched on
    // before its head exists at all.
    body: 'enabled: true\n',
    leaked: 'Powerful features designed to accelerate your success',
    frame: '/test/sections/marketing/showcase/frames/alternating-rows',
  },
  {
    id: 'marketing/product-demo',
    body: 'enabled: true\n',
    leaked: 'Explore powerful features that help you succeed',
    frame: '/test/sections/marketing/product-demo/frames/two-tabs',
  },
  {
    id: 'marketing/pricing-cards',
    // Catalog-driven: no plans, no band — so the brand band under test needs
    // a plan the way the layout bridges one in.
    body: 'plans:\n  - id: "starter"\n    name: "Starter"\n    free: true\n',
    leaked: 'Start free, upgrade when it pays for itself.',
    frame: '/test/sections/marketing/pricing-cards/frames/two-plans',
  },
];

/** The section head cluster alone — its wrapper div closes right after it. */
function headOf(html) {
  const start = html.indexOf('omega-section-head');
  return html.slice(start, html.indexOf('</div>', start));
}

module.exports = defineCases({
  type: 'group',
  description: 'sections-default-copy',
  tests: [
    ...(() => {
      const cases = [];
      for (const band of SWEPT) {
        cases.push({
          name: `#512: ${band.id} inherits no sub line — an absent subheadline renders nothing`,
          run: async (ctx) => {
            const { engine, warnings } = makeEngine();
            const html = await engine.parseAndRender(`{% section "${band.id}" %}\n${band.body}{% endsection %}`, {});

            ctx.expect(!html.includes(band.leaked), 'the demo sentence never reaches a brand band').toBeTruthy();
            ctx.expect(!/<p>[^<]/.test(html.slice(0, html.indexOf('</h2>') + 5)), 'no sub node in the head at all').toBeTruthy();
            ctx.expect(html.includes('<h2 class="omega-display omega-display--section">'), 'the structural head is untouched').toBeTruthy();
            ctx.expect(warnings).toEqual([]);
          },
        });

        cases.push({
          name: `#512: ${band.id} keeps its demo line in the gallery`,
          run: async (ctx) => {
            const pages = await buildWith(miniData, {}, `default-copy-${band.id.replace('/', '-')}`);
            const frame = pages.get(band.frame);
            ctx.expect(frame, `the ${band.id} default variant frame built`).toBeTruthy();

            ctx.expect(frame.includes(band.leaked), 'sample content, where sample content belongs').toBeTruthy();
          },
        });
      }
      return cases;
    })(),

    {
      name: '#512: an authored sub line still renders on the swept bands',
      run: async (ctx) => {
        const { engine } = makeEngine();
        for (const band of SWEPT) {
          const html = await engine.parseAndRender(
            `{% section "${band.id}" %}\nsubheadline: "Our own line."\n${band.body}{% endsection %}`,
            {},
          );
          ctx.expect(html.includes('Our own line.'), `${band.id} renders the page's own words`).toBeTruthy();
        }
      },
    },

    ...(() => {
      const cases = [];
      for (const band of SWEPT_530) {
        cases.push({
          name: `#530: ${band.id} inherits no sub line — an absent subheadline renders nothing`,
          run: async (ctx) => {
            const { engine, warnings } = makeEngine();
            const html = await engine.parseAndRender(`{% section "${band.id}" %}\n${band.body}{% endsection %}`, {});

            ctx.expect(!html.includes(band.leaked), 'the demo sentence never reaches a brand band').toBeTruthy();
            ctx.expect(!/<p>/.test(headOf(html)), 'no sub node in the head at all').toBeTruthy();
            ctx.expect(html.includes('<h2 class="omega-display omega-display--section">'), 'the structural head is untouched').toBeTruthy();
            ctx.expect(warnings).toEqual([]);
          },
        });

        cases.push({
          name: `#530: ${band.id} keeps its demo line in the gallery`,
          run: async (ctx) => {
            const pages = await buildWith(miniData, {}, `default-copy-${band.id.replace('/', '-')}`);
            const frame = pages.get(band.frame);
            ctx.expect(frame, `the ${band.id} default variant frame built`).toBeTruthy();

            ctx.expect(frame.includes(band.leaked), 'sample content, where sample content belongs').toBeTruthy();
          },
        });
      }
      return cases;
    })(),

    {
      name: '#530: an authored sub line still renders on the marketing bands',
      run: async (ctx) => {
        const { engine } = makeEngine();
        for (const band of SWEPT_530) {
          const html = await engine.parseAndRender(
            `{% section "${band.id}" %}\nsubheadline: "Our own line."\n${band.body}{% endsection %}`,
            {},
          );
          ctx.expect(html.includes('Our own line.'), `${band.id} renders the page's own words`).toBeTruthy();
        }
      },
    },
  ],
});
