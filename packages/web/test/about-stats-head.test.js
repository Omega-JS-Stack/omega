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
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
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

test('#472: an authored facts_head renders the band head above the rail', async () => {
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

  assert.ok(html.includes('By the numbers'), 'the superheadline renders');
  // The superheadline is TEXT, always (Ian's 2026-08-22 ruling): an authored
  // icon is ignored on the way in, never an error.
  assert.ok(html.includes('<span class="omega-micro">By the numbers</span>'), 'the label alone, icon key or not');
  assert.ok(!html.includes('data-icon='), 'no omega_icon output in the band head');
  assert.ok(html.includes('The metrics that <em>matter</em>'), 'the headline renders, markup and all');
  assert.ok(html.includes('What the work adds up to.'), 'and the sub line');
  assert.ok(html.includes('omega-section-head'), 'through the shared section-head cluster');

  const headAt = html.indexOf('omega-section-head');
  const railAt = html.indexOf('class="omega-facts"');
  assert.ok(railAt > headAt, 'the head sits ABOVE the rail it heads');
  assert.ok(html.includes('Founded') && html.includes('Team members'), 'the rail still renders every fact');
  assert.deepEqual(warnings, [], 'facts_head is a declared arg — no unknown-arg warning');
});

test('#472: no facts_head — the bare rail, exactly as before', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(`{% section "about/hero" %}\n${FACTS}{% endsection %}`, SITE);

  assert.ok(html.includes('<div class="omega-facts" style="--omega-facts-cols: 2;" data-omega-reveal="left">'),
    'the rail is the untouched two-column grid, revealing itself');
  assert.ok(!html.includes('omega-section-head'), 'no head cluster, empty or otherwise');
  assert.ok(!/<h2/.test(html), 'and no stray heading in the band');
  assert.ok(html.includes('Founded'), 'the facts render as they always did');
  assert.deepEqual(warnings, []);
});

test('#472: the about layout bridges the stats head — the packaged page renders it', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'about-stats-head');
  const html = pages.get('/about');
  assert.ok(html, 'the packaged about page built');

  assert.ok(html.includes('Measuring our <em>impact</em>'), 'the layout\'s stats headline finally has a home');
  assert.ok(html.includes('<span class="omega-micro">Numbers</span>'), 'its superheadline too, as bare words');
  assert.ok(!html.includes('data-icon="chart-line"'), 'and no eyebrow icon — the layout authors none');
  assert.ok(html.includes('The milestones that define our growth'), 'and its subheadline');

  const headAt = html.indexOf('Measuring our');
  const railAt = html.indexOf('class="omega-facts"');
  assert.ok(railAt > headAt, 'the head heads the rail');
  assert.ok(html.includes('Happy customers'), 'the fact rail is untouched');
});

test('#516: the facts head renders its headline_accent, like every other head', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "about/hero" %}\n${FACTS}`
    + 'facts_head:\n'
    + '  headline: "Measuring our"\n'
    + '  headline_accent: "impact"\n'
    + '{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('Measuring our'), 'the headline renders');
  assert.ok(html.includes('<em>impact</em>'), 'and the accent word finally lands in its em');
  assert.deepEqual(warnings, []);
});

test('#516: a head with no accent renders no empty em', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "about/hero" %}\n${FACTS}facts_head:\n  headline: "By the numbers"\n{% endsection %}`,
    SITE,
  );

  assert.ok(html.includes('By the numbers'), 'the head renders');
  assert.ok(!/<em>\s*<\/em>/.test(html), 'and nothing empty tags along');
});

test('#516: the about page bridges the accent from the page\'s own stats head', async () => {
  const { tmp, consumerDir } = makeConsumer({
    stats: { headline: 'Measuring our', headline_accent: 'impact' },
  });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-stats-head-accent');
    const html = pages.get('/about');
    assert.ok(html, 'the about page built');

    assert.ok(html.includes('<em>impact</em>'), 'the accent survives the whole bridge: page data → layout → section → cluster');
    assert.ok(html.includes('Happy customers'), 'the rail is untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#472: a consumer nulling the head keeps the rail bare', async () => {
  const { tmp, consumerDir } = makeConsumer({
    stats: { superheadline: null, headline: null, subheadline: null },
  });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-stats-head-off');
    const html = pages.get('/about');
    assert.ok(html, 'the about page built');

    assert.ok(!html.includes('Measuring our'), 'the head is gone');
    assert.ok(!html.includes('The milestones that define our growth'), 'every line of it');
    assert.ok(html.includes('Happy customers'), 'while the rail keeps its facts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
