/**
 * #493: marketing/pricing-cards — the minimal plan band, on the homepage.
 *
 * The catalog already resolves (`resolved.pricing`, the same view-model
 * /pricing renders) and the home layout simply never surfaced it. Pins: the
 * band renders from that ONE source (no copied numbers), the family `enabled`
 * gate (#473) removes it, an empty catalog renders nothing rather than fiction,
 * the monthly-equivalent figure is the resolver's floored one (#477), and the
 * base index layout composes it directly under the WHY band.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { composePricing } = require('../src/pricing.js');
const { buildSite, miniData, BARE, PKG } = require('./lib/build.js');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const SITE = { site: { brand: { name: 'ACME' } } };

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// The top-level `features` catalog (#647): each feature defined ONCE; the
// products below name only their value.
const FEATURES = {
  requests: { name: 'Requests', icon: 'sparkles', definition: 'API requests per month.', usage: {} },
  support: { name: 'Priority support', icon: 'headset' },
};

const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      tagline: 'best for getting started',
      features: { requests: 100 },
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      tagline: 'best for teams',
      popular: true,
      trial: { days: 14 },
      prices: { monthly: 9.99, annually: 99.99 },
      features: { requests: -1, support: true },
    },
  ],
};

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

/**
 * Render the band with the composed catalog bridged in, exactly as the layout
 * does — the section never sees `resolved`, only args.
 * @param {object} engine - a Liquid engine from makeEngine()
 * @param {object} [args] - extra args merged into the call scope
 * @returns {Promise<string>} rendered html
 */
function renderBand(engine, args = {}) {
  const pricing = composePricing(CATALOG, FEATURES);
  return engine.parseAndRender(
    '{% section "marketing/pricing-cards", plans: bridge.plans, annual: bridge.annual, data: bridge.data %}',
    { ...SITE, bridge: { plans: pricing.plans, annual: false, data: {}, ...args } },
  );
}

/** The band's plan cards (open tag through close). */
function cards(html) {
  return html.match(/<div class="card omega-price-card[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];
}

test('#493: the band renders one card per catalog plan, from the resolved view-model', async () => {
  const { engine, warnings } = makeEngine();
  const html = await renderBand(engine);

  assert.strictEqual((html.match(/omega-price-card__name/g) || []).length, 2, 'one card per plan');
  assert.ok(html.includes('>Basic<') && html.includes('>Premium<'), 'the catalog names render');
  assert.ok(html.includes('9.99'), 'the catalog price renders — no copied number');
  assert.ok(html.includes('Free'), 'the free plan says so instead of $0');
  assert.ok(html.includes('omega-price-card--popular'), 'the popular flag rides through');
  assert.ok(html.includes('Requests') && html.includes('Priority support'), 'the plan features render as bullets');
  assert.ok(html.includes('Unlimited'), 'a -1 limit renders as the resolver names it');
  assert.deepEqual(warnings, [], 'every arg is declared — no unknown-arg warning');
});

test('#493: each card carries exactly one CTA, and it is a real link', async () => {
  const { engine } = makeEngine();
  const html = await renderBand(engine);

  const anchors = html.match(/<a [^>]*class="btn [^"]*"[^>]*>/g) || [];
  assert.strictEqual(anchors.length, 2, 'one CTA per card, no more');
  assert.ok(!html.includes('data-plan-id'), 'no checkout button: the pricing page module is page-scoped, so one here would be dead');
  assert.ok(html.includes('href="/signup"'), 'the free plan keeps the resolver\'s own signup url');
  assert.ok(html.includes('href="/pricing"'), 'a plan with no url of its own sends you to the full page');
  assert.ok(html.includes('Get free trial'), 'the trial CTA comes from product.trial.days, like /pricing');
});

test('#493: the monthly-equivalent figure is the resolver\'s floored one (#477)', async () => {
  const { engine } = makeEngine();
  const annual = await renderBand(engine, { annual: true });

  // 99.99 / 12 = 8.33 → the resolver floors to 8; the band never recomputes it.
  assert.ok(annual.includes('>8<'), `the annual view shows the floored monthly equivalent: ${annual.slice(annual.indexOf('omega-price-card__amount'), annual.indexOf('omega-price-card__amount') + 120)}`);
  assert.ok(!annual.includes('8.33'), 'no band-side arithmetic');
});

test('#493: enabled: false removes the band entirely (#473 family gate)', async () => {
  const { engine, warnings } = makeEngine();
  const html = await renderBand(engine, { data: { enabled: false } });

  assert.strictEqual(html.trim(), '', 'no band, no empty shell');
  assert.deepEqual(warnings, [], 'the gate is a declared arg');
});

test('#493: no catalog renders nothing — never fiction', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/pricing-cards" %}', SITE);

  assert.strictEqual(html.trim(), '', 'a brand with no published plans ships no plan band');
});

/**
 * #539 — Ian's QA veto (2026-08-24): the band showed plan names and prices
 * with plain feature bullets, so the hover explanations the catalog authors
 * (`feature.definition`) only ever surfaced on /pricing. The mechanism is
 * ONE home now — the `pricing/features` component both surfaces compose —
 * and the overflow line reads `and:` (the wording /pricing carries too).
 */
test('#539: the band carries /pricing\'s hoverable feature surface, from the one component', async () => {
  const { engine, warnings } = makeEngine();
  const html = await renderBand(engine);

  assert.ok(html.includes('data-bs-toggle="tooltip"'), 'the definition rides the same tooltip trigger /pricing uses');
  assert.ok(html.includes('data-bs-title="API requests per month."'), 'with the catalog\'s own words');
  assert.match(html, /text-decoration-underline text-decoration-dotted cursor-help/, 'and the dotted-underline hover affordance');
  assert.strictEqual((html.match(/data-bs-toggle="tooltip"/g) || []).length, 2, 'one per definition-carrying bullet — a feature WITHOUT a definition stays plain text');
  assert.ok(!/cursor-help[^>]*>Priority support/.test(html), 'the undefined feature is not made hoverable');
  assert.deepEqual(warnings, [], 'the component call declares every arg it passes');
});

test('#539: the overflow line reads "and:"', async () => {
  const { engine } = makeEngine();
  const html = await renderBand(engine);

  assert.match(html, /Everything in\s*<strong>Basic<\/strong>, and:/, 'Ian\'s wording (2026-08-24), on the band');
  assert.ok(!html.includes('and more:'), 'the wording it replaced is gone');
  assert.ok(html.includes('omega-price-card__tier-note'), 'the line wears /pricing\'s own tier-note vocabulary');
});

/**
 * Ian's QA extension (2026-08-24 PM): /pricing's overflow label reads `and:`
 * too. His ruling, recorded — the same thing renders the same everywhere; a
 * thing either exists or it does not, it never differs by page. So the band's
 * wording IS the wording, and `and more:` is gone from the framework.
 */
test('#539: /pricing\'s overflow line reads "and:" too — one wording, both surfaces', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pricing-parity-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });

  try {
    const pages = await buildSite(consumerDir, { ...bareData, ...miniData, features: FEATURES, payment: CATALOG }, {}, 'pricing-cards-parity');
    const html = pages.get('/pricing');

    assert.ok(html, 'the packaged /pricing default built');
    assert.match(html, /Everything in\s*<strong>Basic<\/strong>, and:/, 'Ian\'s wording (2026-08-24 PM), on the page too');
    assert.ok(!html.includes('and more:'), 'the old page-only wording is gone');
    assert.ok(html.includes('data-bs-title="API requests per month."'), 'and its feature definitions still hover');
    assert.match(html, /text-decoration-underline text-decoration-dotted cursor-help/, 'through the same affordance');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#493: the base index layout composes the band under the WHY band', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pricing-cards-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'index.md'),
    ['---', 'layout: blueprint/index', 'permalink: /', '---', ''].join('\n'),
  );

  try {
    const pages = await buildSite(consumerDir, { ...bareData, ...miniData, features: FEATURES, payment: CATALOG }, {}, 'pricing-cards-index');
    const html = pages.get('/');

    assert.ok(html.includes('omega-price-card'), 'the homepage carries the plan band');
    assert.ok(html.includes('>Premium<'), 'with the brand\'s own catalog plans');

    const whyAt = html.indexOf('omega-bento');
    const bandAt = html.indexOf('omega-price-card');
    const demoAt = html.indexOf('marketing/product-demo');
    assert.ok(whyAt > -1 && bandAt > whyAt, 'the band lands UNDER the WHY band, not above it');
    if (demoAt > -1) {
      assert.ok(bandAt < demoAt, 'and above the bands that used to follow it');
    }

    // Exactly one h1 still: the band's head is an h2, its plan names h3s.
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, 'the composition keeps one h1');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
