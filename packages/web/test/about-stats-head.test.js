/**
 * #472 — the about page's stats band head. The layout bridged only
 * `resolved.stats.items` into the fact rail, so a band's own words
 * (superheadline / headline / subheadline — the legacy "By the numbers" head)
 * were authored and silently dropped. The rail now takes a `facts_head` arg:
 * authored words render above it, an unauthored rail is the bare grid it has
 * always been. Pinned at the section seam (the arg contract) and over the real
 * about page (the layout bridge, plus a consumer nulling the head out).
 *
 * #516 — the head took every word but one: `headline_accent` was dropped on
 * the way into the cluster, so a legacy "Measuring our IMPACT" rendered as
 * "Measuring our". The facts head now passes the accent through like every
 * other head composition.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildSite, BARE, PKG } = require('./lib/build.js');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const SITE = { site: { brand: { name: 'ACME' } } };
const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const FACTS = 'facts:\n  - number: "2017"\n    label: Founded\n  - number: "50+"\n    label: Team members\n';

/** Fresh engine over the REAL base theme layer with a captured warn sink. */
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

/** A consumer /about riding the blueprint, with its band data in the sidecar. */
function makeConsumer(sidecar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-about-stats-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.md'),
    ['---', 'layout: blueprint/about', 'permalink: /about', '---', ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.11tydata.json'),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'about-stats-head',
  tests: [
    {
      name: '#472: an authored facts_head renders the band head above the rail',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          `{% section "about/hero" %}\n${FACTS}`
          + 'facts_head:\n'
          + '  superheadline:\n    icon: "chart-line"\n    text: "By the numbers"\n'
          + '  headline: "The metrics that <em>matter</em>"\n'
          + '  subheadline: "What the work adds up to."\n'
          + '{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('By the numbers'), 'the superheadline renders').toBeTruthy();
        // The superheadline is TEXT, always (Ian's 2026-08-22 ruling): an authored
        // icon is ignored on the way in, never an error.
        ctx.expect(html.includes('<span class="omega-micro">By the numbers</span>'), 'the label alone, icon key or not').toBeTruthy();
        ctx.expect(!/<i class="fa-/.test(html), 'no icon markup in the band head').toBeTruthy();
        ctx.expect(html.includes('The metrics that <em>matter</em>'), 'the headline renders, markup and all').toBeTruthy();
        ctx.expect(html.includes('What the work adds up to.'), 'and the sub line').toBeTruthy();
        ctx.expect(html.includes('omega-section-head'), 'through the shared section-head cluster').toBeTruthy();

        const headAt = html.indexOf('omega-section-head');
        const railAt = html.indexOf('class="omega-facts"');
        ctx.expect(railAt > headAt, 'the head sits ABOVE the rail it heads').toBeTruthy();
        ctx.expect(html.includes('Founded') && html.includes('Team members'), 'the rail still renders every fact').toBeTruthy();
        ctx.expect(warnings, 'facts_head is a declared arg — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#472: no facts_head — the bare rail, exactly as before',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(`{% section "about/hero" %}\n${FACTS}{% endsection %}`, SITE);

        // The rail lost its reveal attribute in #467: about/hero is the about page's
        // first viewport, so the whole band paints with the document
        // (test/first-paint-bands.test.js owns that promise).
        ctx.expect(html.includes('<div class="omega-facts" style="--omega-facts-cols: 2;">'), 'the rail is the untouched two-column grid').toBeTruthy();
        ctx.expect(!html.includes('omega-section-head'), 'no head cluster, empty or otherwise').toBeTruthy();
        ctx.expect(!/<h2/.test(html), 'and no stray heading in the band').toBeTruthy();
        ctx.expect(html.includes('Founded'), 'the facts render as they always did').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#472: the about layout bridges the stats head — the packaged page renders it',
      run: async (ctx) => {
        const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'about-stats-head');
        const html = pages.get('/about');
        ctx.expect(html, 'the packaged about page built').toBeTruthy();

        ctx.expect(html.includes('Measuring our <em>impact</em>'), 'the layout\'s stats headline finally has a home').toBeTruthy();
        ctx.expect(html.includes('<span class="omega-micro">Numbers</span>'), 'its superheadline too, as bare words').toBeTruthy();
        ctx.expect(!html.includes('data-icon="chart-line"'), 'and no eyebrow icon — the layout authors none').toBeTruthy();
        ctx.expect(html.includes('The milestones that define our growth'), 'and its subheadline').toBeTruthy();

        const headAt = html.indexOf('Measuring our');
        const railAt = html.indexOf('class="omega-facts"');
        ctx.expect(railAt > headAt, 'the head heads the rail').toBeTruthy();
        ctx.expect(html.includes('Happy customers'), 'the fact rail is untouched').toBeTruthy();
      },
    },

    {
      name: '#516: the facts head renders its headline_accent, like every other head',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          `{% section "about/hero" %}\n${FACTS}`
          + 'facts_head:\n'
          + '  headline: "Measuring our"\n'
          + '  headline_accent: "impact"\n'
          + '{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('Measuring our'), 'the headline renders').toBeTruthy();
        ctx.expect(html.includes('<em>impact</em>'), 'and the accent word finally lands in its em').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#516: a head with no accent renders no empty em',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          `{% section "about/hero" %}\n${FACTS}facts_head:\n  headline: "By the numbers"\n{% endsection %}`,
          SITE,
        );

        ctx.expect(html.includes('By the numbers'), 'the head renders').toBeTruthy();
        ctx.expect(!/<em>\s*<\/em>/.test(html), 'and nothing empty tags along').toBeTruthy();
      },
    },

    {
      name: '#516: the about page bridges the accent from the page\'s own stats head',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          stats: { headline: 'Measuring our', headline_accent: 'impact' },
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-stats-head-accent');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          ctx.expect(html.includes('<em>impact</em>'), 'the accent survives the whole bridge: page data → layout → section → cluster').toBeTruthy();
          ctx.expect(html.includes('Happy customers'), 'the rail is untouched').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#472: a consumer nulling the head keeps the rail bare',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          stats: { superheadline: null, headline: null, subheadline: null },
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-stats-head-off');
          const html = pages.get('/about');
          ctx.expect(html, 'the about page built').toBeTruthy();

          ctx.expect(!html.includes('Measuring our'), 'the head is gone').toBeTruthy();
          ctx.expect(!html.includes('The milestones that define our growth'), 'every line of it').toBeTruthy();
          ctx.expect(html.includes('Happy customers'), 'while the rail keeps its facts').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
