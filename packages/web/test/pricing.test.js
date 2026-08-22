/**
 * C2 pricing — payment.products is the ONLY pricing source.
 *
 * Unit half: composePricing's view-model contract (plan/one-time split,
 * free detection, limits fallback, -1 → Unlimited, common/extra features,
 * comparison inheritance, billing-toggle availability, honest savings %).
 *
 * Integration half: the packaged themes render /pricing from config alone —
 * plans from the catalog, one-time section per type (friction #7), the honest
 * empty state on a bare catalog (friction #6), and zero dispersal-era
 * fiction (Plus/Pro/Max, fake social proof) anywhere in the output.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { composePricing } = require('../src/pricing.js');
const { catalogWarning } = require('../src/commands/build.js');
const { buildSite, buildWith: sharedBuildWith, miniData, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'pricing-test');

const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      tagline: 'best for getting started',
      limits: { requests: 100 },
      features: [
        { id: 'requests', name: 'Requests', icon: 'sparkles', definition: 'API requests per month.' },
      ],
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      tagline: 'best for teams',
      popular: true,
      limits: { requests: -1 },
      trial: { days: 14 },
      prices: { monthly: 9.99, annually: 99.99 },
      features: [
        { id: 'requests', name: 'Requests', icon: 'sparkles' },
        { id: 'support', name: 'Priority support', icon: 'headset', value: true },
      ],
    },
    {
      id: 'launch-kit',
      name: 'Launch Kit',
      type: 'one-time',
      tagline: 'everything to ship day one',
      prices: { once: 49.99 },
    },
  ],
};

test('composePricing: subscription/one-time split, free detection, limits fallback', () => {
  const pricing = composePricing(CATALOG);

  assert.strictEqual(pricing.plans.length, 2, 'one-time products stay out of the plan grid');
  assert.strictEqual(pricing.oneTime.length, 1);

  const [basic, premium] = pricing.plans;
  assert.strictEqual(basic.free, true, 'no prices → free');
  assert.strictEqual(basic.url, '/signup', 'free plans default to the signup CTA');
  assert.strictEqual(basic.features[0].value, 100, 'feature value falls back to limits[id]');
  assert.strictEqual(basic.features[0].definition, 'API requests per month.');

  assert.strictEqual(premium.free, false);
  assert.strictEqual(premium.url, null, 'paid plans without a url get a checkout button');
  assert.strictEqual(premium.popular, true);
  assert.strictEqual(premium.trialDays, 14);
  assert.strictEqual(premium.prices.annuallyPerMonth, 8, '99.99/12 rounds for the card display');
  assert.strictEqual(premium.features[0].value, 'Unlimited', '-1 limit renders as Unlimited');
  assert.strictEqual(premium.features[1].value, true, 'explicit feature value wins');

  const kit = pricing.oneTime[0];
  assert.strictEqual(kit.price, 49.99);
  assert.strictEqual(kit.tagline, 'everything to ship day one');
});

test('composePricing: definitions backfill by id — author once, tooltip everywhere', () => {
  const pricing = composePricing(CATALOG);
  const [, premium] = pricing.plans;

  // premium's `requests` copy declares NO definition — it inherits basic's,
  // so every plan card (not just the first) renders the dotted tooltip
  assert.strictEqual(premium.features[0].definition, 'API requests per month.');
  assert.strictEqual(
    premium.commonFeatures.find((f) => f.id === 'requests').definition,
    'API requests per month.',
    'the split keeps the backfilled objects',
  );
});

test('composePricing: common/extra split + comparison inheritance', () => {
  const pricing = composePricing(CATALOG);
  const [basic, premium] = pricing.plans;

  assert.deepStrictEqual(basic.commonFeatures.map((f) => f.id), ['requests'], 'requests is in every plan');
  assert.deepStrictEqual(premium.extraFeatures.map((f) => f.id), ['support'], 'support is premium-only');

  const support = pricing.comparison.features.find((f) => f.id === 'support');
  assert.strictEqual(support.values.basic, null, 'basic genuinely lacks support (no earlier plan to inherit from)');
  assert.strictEqual(support.values.premium, true);

  const requests = pricing.comparison.features.find((f) => f.id === 'requests');
  assert.strictEqual(requests.values.basic, 100);
  assert.strictEqual(requests.values.premium, 'Unlimited');
});

test('composePricing: comparison values inherit from earlier tiers', () => {
  const pricing = composePricing({
    products: [
      { id: 'a', name: 'A', features: [{ id: 'x', name: 'X', value: 10 }] },
      { id: 'b', name: 'B', prices: { monthly: 5 }, features: [{ id: 'y', name: 'Y', value: true }] },
    ],
  });
  const x = pricing.comparison.features.find((f) => f.id === 'x');
  assert.strictEqual(x.values.b, 10, 'b inherits x from a (tiers accumulate)');
});

test('composePricing: billing availability + honest savings badge', () => {
  const both = composePricing(CATALOG);
  assert.deepStrictEqual(both.billing, { monthly: true, annually: true });
  assert.strictEqual(both.savingsPercent, 17, '99.99 vs 9.99*12 → 17%');

  const monthlyOnly = composePricing({ products: [{ id: 'p', name: 'P', prices: { monthly: 5 } }] });
  assert.deepStrictEqual(monthlyOnly.billing, { monthly: true, annually: false }, 'no toggle without both cadences');
  assert.strictEqual(monthlyOnly.savingsPercent, 0);
});

test('composePricing: empty/absent catalog → null (honest empty state)', () => {
  assert.strictEqual(composePricing(undefined), null);
  assert.strictEqual(composePricing({}), null);
  assert.strictEqual(composePricing({ products: [] }), null);
});

test('composePricing: untyped products default to subscription', () => {
  const pricing = composePricing({ products: [{ id: 'p', name: 'P' }] });
  assert.strictEqual(pricing.plans.length, 1);
});

for (const theme of ['classy', 'neobrutalism', 'newsflash']) {
  test(`${theme}: /pricing renders from the catalog alone (plans, one-time, checkout wiring)`, async () => {
    const pages = await buildWith({ ...miniData, payment: CATALOG }, { activeTheme: theme });
    const html = pages.get('/pricing');

    // Plans from config
    assert.ok(html.includes('Basic'), `${theme}: catalog plan name`);
    assert.ok(html.includes('Premium'), `${theme}: catalog plan name`);
    assert.ok(html.includes('best for teams'), `${theme}: product tagline`);
    assert.ok(!html.includes('>Plus<') && !html.includes('>Pro<') && !html.includes('>Max<'), `${theme}: no fictional plans`);

    // Prices + checkout wiring
    assert.ok(html.includes('data-plan-id="premium"'), `${theme}: paid plan checkout button`);
    assert.ok(html.includes('data-plan-type="subscription"'), `${theme}: type attribute for frequency logic`);
    assert.ok(html.includes('data-monthly="9.99"'), `${theme}: monthly price data attribute`);
    assert.ok(html.includes('Get free trial'), `${theme}: trial CTA from product.trial.days`);
    assert.ok(html.includes('href="/signup"'), `${theme}: free plan anchors to signup`);

    // One-time products get their own presentation (friction #7)
    assert.ok(html.includes('Launch Kit'), `${theme}: one-time product rendered`);
    assert.ok(html.includes('data-plan-type="one-time"'), `${theme}: one-time checkout type`);
    assert.ok(html.includes('49.99'), `${theme}: one-time price`);

    // Savings badge computes from real prices; marketing chrome ships ON by
    // default (Ian 2026-07-11: banner/social proof/FAQ defaults are product
    // behavior — only PLAN fiction is dead)
    assert.ok(html.includes('17%'), `${theme}: computed savings badge`);
    assert.ok(html.includes('WELCOME15'), `${theme}: promo banner on by default`);
    assert.ok(html.includes('id="pricing-promo-banner"'), `${theme}: banner markup present`);
  });

  test(`${theme}: bare catalog → honest empty state (friction #6)`, async () => {
    const pages = await buildWith({ ...miniData, payment: undefined }, { activeTheme: theme });
    const html = pages.get('/pricing');

    assert.ok(!html.includes('data-plan-id='), `${theme}: no plan buttons`);
    assert.ok(!html.includes('>Basic<') && !html.includes('>Plus<'), `${theme}: no plans at all`);
    assert.ok(html.includes('id="pricing-empty"'), `${theme}: explicit empty state`);
    assert.ok(!html.includes('name="billing"'), `${theme}: no billing toggle`);
  });
}

test('wave-3 W5: out-of-order catalog warns (comparison inherits by catalog order)', () => {
  const warnings = [];
  const original = console.warn;
  // The composer warns through the devkit logger, so the tag arrives as its own
  // argument ahead of the message — join what one call printed.
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    composePricing({
      products: [
        { id: 'pro', name: 'Pro', prices: { monthly: 20 } },
        { id: 'basic', name: 'Basic', prices: { monthly: 5 } },
      ],
    });
    assert.equal(warnings.length, 1, 'non-monotonic prices warn');
    assert.ok(warnings[0].includes('"basic"') && warnings[0].includes('"pro"'), 'names both plans');

    warnings.length = 0;
    composePricing({
      products: [
        { id: 'basic', name: 'Basic', prices: { monthly: 5 } },
        { id: 'pro', name: 'Pro', prices: { monthly: 20 } },
      ],
    });
    assert.equal(warnings.length, 0, 'ascending catalog stays silent');
  } finally {
    console.warn = original;
  }
});

test('classy: monthly-only catalog hides the billing toggle', async () => {
  const pages = await buildWith({
    ...miniData,
    payment: { products: [{ id: 'solo', name: 'Solo', prices: { monthly: 5 } }] },
  });
  const html = pages.get('/pricing');
  assert.ok(!html.includes('name="billing"'), 'no toggle without both cadences');
  assert.ok(html.includes('data-plan-id="solo"'), 'plan still renders');
});

test('classy: marketing chrome defaults ship ON (Ian 2026-07-11 — social proof, testimonials, FAQs)', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const html = pages.get('/pricing');
  assert.ok(html.includes('5M'), 'default social proof');
  assert.ok(html.includes('Sarah Johnson'), 'default testimonials');
  assert.ok(html.includes('Can I cancel at any time?'), 'default FAQs');
  // The guarantee line is brand copy now (#273) — it renders only for a brand
  // that states one, and never invents a refund window.
  assert.ok(!html.includes('omega-guarantee-icon'), 'no guarantee line without brand copy');
});

// The brand-copy lane for the guarantee (#273): the site-wide directory-data
// layer, which deep-merges over the engine-composed resolved.pricing.
test('#273: a brand that states a guarantee gets the line back', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-guarantee-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'src.11tydata.json'),
    JSON.stringify({ pricing: { guarantee: 'Backed by our 30-day promise' } }),
  );
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'pricing.md'),
    ['---', 'layout: blueprint/pricing', 'permalink: /pricing', '---', ''].join('\n'),
  );

  try {
    const pages = await buildSite(consumerDir, { ...bareData, payment: CATALOG }, {}, 'pricing-guarantee');
    const html = pages.get('/pricing');
    assert.ok(html.includes('Backed by our 30-day promise'), 'the brand-stated guarantee renders');
    assert.ok(html.includes('omega-guarantee-icon'), 'with its shield');
    // Same gate for the FAQ aside's decoration of that promise (#273).
    assert.ok(/money-back guarantee/i.test(html), 'the FAQ aside chip comes back with it');
    assert.ok(/refunded/i.test(html), 'and so does the refund fragment');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('composePricing: the enterprise product leaves the grid (issue #44 item 8)', () => {
  const pricing = composePricing({
    products: [
      ...CATALOG.products,
      { id: 'enterprise', name: 'Bindery', enterprise: true, tagline: 'for organizations', features: [{ id: 'sso', name: 'SSO' }] },
    ],
  });

  assert.strictEqual(pricing.plans.length, 2, 'the enterprise tier is not a plan card');
  assert.ok(!pricing.comparison.features.some((f) => f.id === 'sso'), 'nor a comparison column');
  assert.strictEqual(pricing.enterprise.name, 'Bindery');
  assert.strictEqual(pricing.enterprise.tagline, 'for organizations');
  assert.strictEqual(pricing.enterprise.url, '/contact', 'contact CTA by default');
  assert.deepStrictEqual(pricing.enterprise.features.map((f) => f.name), ['SSO']);

  assert.strictEqual(composePricing(CATALOG).enterprise, null, 'no enterprise product → nothing to render');
});

test('composePricing: the enterprise flag wins over the type — one product, one lane', () => {
  const pricing = composePricing({
    products: [
      ...CATALOG.products,
      { id: 'partnership', name: 'Partnership', type: 'one-time', enterprise: true, prices: { once: 5000 } },
    ],
  });

  assert.deepStrictEqual(pricing.oneTime.map((p) => p.id), ['launch-kit'], 'an enterprise-flagged one-time product leaves the one-time grid too');
  assert.strictEqual(pricing.enterprise.id, 'partnership', 'it renders as the enterprise row, once');
});

test('classy: the enterprise row renders only when the catalog declares it (issue #44 item 8)', async () => {
  const withEnterprise = await buildWith({
    ...miniData,
    payment: {
      products: [
        ...CATALOG.products,
        {
          id: 'enterprise',
          name: 'Bindery',
          enterprise: true,
          tagline: 'for organizations that need their own terms',
          url: '/contact',
          features: [{ id: 'sso', name: 'SSO & provisioning', value: true }],
        },
      ],
    },
  });
  const html = withEnterprise.get('/pricing');

  assert.ok(html.includes('omega-band--enterprise'), 'its own full-width row, not a card');
  assert.ok(html.includes('Bindery'), 'plan name from the catalog');
  assert.ok(html.includes('for organizations that need their own terms'), 'the one-line pitch');
  assert.ok(html.includes('SSO & provisioning'), 'the feature list');
  assert.ok(html.includes('data-plan-enterprise="enterprise"'), 'contact CTA (a link, not a checkout button)');
  assert.ok(!html.includes('data-plan-id="enterprise"'), 'never a card in the grid');

  const without = await buildWith({ ...miniData, payment: CATALOG });
  assert.ok(!without.get('/pricing').includes('omega-band--enterprise'), 'no enterprise in the data → no row');
});

// Neither partial theme forks a pricing layout (#177 phases 2 + 3): their
// /pricing renders the BASE page, so the enterprise strip wears the base
// omega-band idiom and the comparison table returns with the base page.
for (const theme of ['neobrutalism', 'newsflash']) {
  test(`${theme}: /pricing falls through to the base page; enterprise rides the omega-band idiom (#177)`, async () => {
    const withEnterprise = await buildWith({
      ...miniData,
      payment: {
        products: [
          ...CATALOG.products,
          {
            id: 'enterprise',
            name: 'Bindery',
            enterprise: true,
            tagline: 'for organizations that need their own terms',
            url: '/contact',
            features: [{ id: 'sso', name: 'SSO & provisioning', value: true }],
          },
        ],
      },
    }, { activeTheme: theme });
    const html = withEnterprise.get('/pricing');

    assert.ok(html.includes('omega-band--enterprise'), `${theme}: the base full-width row serves`);
    assert.ok(html.includes('Bindery'), `${theme}: plan name from the catalog`);
    assert.ok(html.includes('for organizations that need their own terms'), `${theme}: the one-line pitch`);
    assert.ok(html.includes('SSO & provisioning'), `${theme}: the feature list`);
    assert.ok(html.includes('data-plan-enterprise="enterprise"'), `${theme}: contact CTA (a link, not a checkout button)`);
    assert.ok(html.includes('href="/contact"'), `${theme}: the CTA points at the product url`);
    assert.ok(!html.includes('data-plan-id="enterprise"'), `${theme}: never a card in the grid`);
    assert.ok(html.includes('omega-compare'), `${theme}: the feature-comparison table returns with the base page`);

    // The invented copy the old always-on strip carried is gone
    assert.ok(!html.includes('Custom solutions for large organizations'), `${theme}: no fictional enterprise blurb`);
    assert.ok(!html.includes('Bulk memberships for companies'), `${theme}: no fictional group-access blurb`);

    const without = await buildWith({ ...miniData, payment: CATALOG }, { activeTheme: theme });
    assert.ok(!without.get('/pricing').includes('data-plan-enterprise'), `${theme}: no enterprise in the data → no strip`);
    assert.ok(!without.get('/pricing').includes('>Enterprise<'), `${theme}: nor its heading`);
  });
}

test('classy: consumer frontmatter still overrides presentation (consumer surface)', async () => {
  // The mini fixture has no consumer pricing page — resolved.pricing comes
  // from the site seed; hero copy proves the template-default path.
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const html = pages.get('/pricing');
  assert.ok(html.includes('The right plans,'), 'template hero default');
  assert.ok(html.includes('for the right price'), 'template hero accent default');
});

/** Heading levels inside <main>, in document order. @returns {number[]} */
function headingLevels(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

// #270 — the cards band is the SHELL's, not the consumer page's, so every
// brand on the blueprint shipped the same skip: the h1 was followed straight
// by the h3 card names with no h2 between them.
test('#270: the pricing shell never skips a heading level (h1 → h3)', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const levels = headingLevels(pages.get('/pricing'));

  assert.strictEqual(levels[0], 1, 'the page opens on its single h1');
  assert.strictEqual(levels[1], 2, 'the cards band carries an h2 under it');
  levels.forEach((level, i) => {
    if (i === 0) return;
    assert.ok(level <= levels[i - 1] + 1, `heading ${i} (h${level}) does not skip past h${levels[i - 1]}`);
  });

  const html = pages.get('/pricing');
  assert.ok(/<h2 class="visually-hidden">/.test(html), 'the band heading is visually hidden — the design is unchanged');
});

// #273 — the defaults shipped a "7-day money-back guarantee" line beside a
// "14-day free trial" FAQ answer: contradictory, and both invented for any
// catalog. Trial copy now derives from the catalog (rendered only when it has
// one), and the refund claims are gone — a refund policy is brand copy.
const NO_TRIAL = { products: CATALOG.products.map((product) => ({ ...product, trial: undefined })) };

test('#273: the trial FAQ derives from the catalog — a 14-day trial states 14 days', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const html = pages.get('/pricing');

  assert.ok(html.includes('Is there a free trial?'), 'the trial FAQ renders for a catalog that has one');
  assert.ok(/14-day free trial/.test(html), 'and states the catalog\'s real number');
  assert.ok(!/\d+-day money-back guarantee/.test(html), 'no invented money-back guarantee anywhere');
  assert.ok(!html.includes('What is your refund policy?'), 'no invented refund policy in the framework defaults');

  // The FAQ aside's decorative twins are the same claim in chrome — a refund
  // promise the framework cannot make for a brand.
  assert.ok(!/money-back guarantee/i.test(html), 'no money-back chip in the FAQ aside');
  assert.ok(!/refunded/i.test(html), 'no refund fragment in the FAQ aside');
  // What the framework DOES know still ships: the plan-switch route prorates.
  assert.ok(html.includes('prorated'), 'the proration behavior is real product copy and stays');
});

test('#273: a catalog with no trial renders no trial copy at all', async () => {
  const pages = await buildWith({ ...miniData, payment: NO_TRIAL });
  const html = pages.get('/pricing');

  assert.ok(!html.includes('Is there a free trial?'), 'no trial in the catalog → no trial FAQ');
  assert.ok(!/free trial/i.test(html), 'and no trial claim anywhere on the page');
  assert.ok(html.includes('Can I cancel at any time?'), 'the honest defaults still ship');

  const schema = JSON.parse(html.match(/<script id="omega-schema-faq-page"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.ok(schema.mainEntity.every((entry) => entry.acceptedAnswer.text.trim() !== ''), 'the FAQPage schema carries no empty answers');
});

// #273 follow-up — the page speaks ONE trial number ("every paid plan starts
// with a N-day free trial"), so that number only exists when the paid plans
// agree. A catalog whose paid plans carry different trials (or one without a
// trial at all) states nothing universal.
const MIXED_TRIALS = {
  products: [
    { id: 'starter', name: 'Starter', prices: { monthly: 5 }, trial: { days: 14 } },
    { id: 'pro', name: 'Pro', prices: { monthly: 20 } },
  ],
};
const UNIFORM_TRIALS = {
  products: [
    { id: 'starter', name: 'Starter', prices: { monthly: 5 }, trial: { days: 14 } },
    { id: 'pro', name: 'Pro', prices: { monthly: 20 }, trial: { days: 14 } },
  ],
};

test('composePricing: the universal trial number needs unanimity among paid plans', () => {
  assert.strictEqual(composePricing(MIXED_TRIALS).trialDays, 0, 'paid plans disagreeing → no number the page can speak');
  assert.strictEqual(composePricing(UNIFORM_TRIALS).trialDays, 14, 'every paid plan on 14 days → 14');
  assert.strictEqual(
    composePricing(CATALOG).trialDays,
    14,
    'a free plan carries no trial to disagree with — the paid plans decide',
  );
  assert.strictEqual(composePricing(NO_TRIAL).trialDays, 0, 'no trial anywhere → 0');
});

test('#273 follow-up: a mixed-trial catalog claims no universal trial', async () => {
  const pages = await buildWith({ ...miniData, payment: MIXED_TRIALS });
  const html = pages.get('/pricing');

  assert.ok(!html.includes('Is there a free trial?'), 'paid plans disagree → no trial FAQ');
  assert.ok(!/\d+-day free trial/.test(html), 'and no universal trial claim anywhere');
  // The per-plan truth is untouched: the plan that HAS a trial still says so.
  assert.ok(html.includes('Get free trial'), 'the trialing plan keeps its own CTA');

  const uniform = await buildWith({ ...miniData, payment: UNIFORM_TRIALS }, {}, 'pricing-uniform-trial');
  const uniformHtml = uniform.get('/pricing');
  assert.ok(uniformHtml.includes('Is there a free trial?'), 'a catalog that agrees keeps the FAQ');
  assert.ok(/14-day free trial/.test(uniformHtml), 'and states the shared number');
});

// #270 follow-up — the enterprise band is the SHELL's too, and its title is an
// h3: an enterprise-only catalog renders no plans band, so nothing supplied the
// h2 between the hero h1 and that h3.
const ENTERPRISE_ONLY = {
  products: [
    {
      id: 'enterprise',
      name: 'Bindery',
      enterprise: true,
      tagline: 'for organizations that need their own terms',
      url: '/contact',
      features: [{ id: 'sso', name: 'SSO & provisioning', value: true }],
    },
  ],
};

test('#270 follow-up: an enterprise-only catalog never skips a heading level', async () => {
  const pages = await buildWith({ ...miniData, payment: ENTERPRISE_ONLY }, {}, 'pricing-enterprise-only');
  const html = pages.get('/pricing');
  const levels = headingLevels(html);

  assert.ok(html.includes('omega-band--enterprise'), 'the enterprise row is the only band on the page');
  assert.strictEqual(levels[0], 1, 'the page opens on its single h1');
  assert.strictEqual(levels[1], 2, 'the enterprise band carries an h2 under it');
  levels.forEach((level, i) => {
    if (i === 0) return;
    assert.ok(level <= levels[i - 1] + 1, `heading ${i} (h${level}) does not skip past h${levels[i - 1]}`);
  });
});

// #348 — the QA tier is a real product: created on every provider and
// purchasable by id, but never a card on the pricing page. `hidden: true` is
// presentation-only, so the composer drops it before any lane reads the
// catalog (including the numbers the page speaks).
const HIDDEN_QA = {
  products: [
    ...CATALOG.products,
    {
      id: 'proof-press',
      name: 'Proof Press',
      type: 'subscription',
      tagline: 'test prints, pulled immediately',
      hidden: true,
      prices: { monthly: 5 },
      features: [{ id: 'proofs', name: 'Proof pulls', icon: 'flask' }],
    },
  ],
};

test('composePricing: a hidden product leaves every rendered lane (#348)', () => {
  const pricing = composePricing(HIDDEN_QA);

  assert.deepStrictEqual(pricing.plans.map((plan) => plan.id), ['basic', 'premium'], 'not a plan card');
  assert.ok(!pricing.comparison.features.some((feature) => feature.id === 'proofs'), 'nor a comparison row');
  assert.strictEqual(
    pricing.trialDays,
    14,
    'nor a vote on the universal trial number (a trial-free QA tier would zero it)',
  );

  const hiddenOneTime = composePricing({
    products: [...CATALOG.products, { id: 'qa-pack', name: 'QA Pack', type: 'one-time', hidden: true, prices: { once: 5 } }],
  });
  assert.deepStrictEqual(hiddenOneTime.oneTime.map((product) => product.id), ['launch-kit'], 'nor a one-time card');

  const hiddenEnterprise = composePricing({
    products: [...CATALOG.products, { id: 'qa-terms', name: 'QA Terms', enterprise: true, hidden: true }],
  });
  assert.strictEqual(hiddenEnterprise.enterprise, null, 'nor the enterprise row');

  assert.strictEqual(
    composePricing({ products: [{ id: 'proof-press', name: 'Proof Press', hidden: true, prices: { monthly: 5 } }] }),
    null,
    'a catalog of nothing but hidden products renders the honest empty state',
  );
});

test("`omega build`'s empty-catalog warning counts the VISIBLE catalog (#348)", () => {
  assert.strictEqual(catalogWarning(CATALOG), null, 'a catalog with cards warns about nothing');
  assert.strictEqual(catalogWarning(HIDDEN_QA), null, 'nor does one that merely CONTAINS a hidden product');

  // The page renders #pricing-empty here, so the build must say so — and say
  // WHICH config state it is, or the reader hunts a catalog that is not bare.
  const allHidden = catalogWarning({
    products: [
      { id: 'proof-press', name: 'Proof Press', hidden: true, prices: { monthly: 5 } },
      { id: 'qa-pack', name: 'QA Pack', type: 'one-time', hidden: true, prices: { once: 5 } },
    ],
  });
  assert.match(allHidden, /lists 2 products, every one marked hidden/, 'an all-hidden catalog warns, named for what it is');
  assert.match(allHidden, /empty state/, 'and says what the page renders');
  assert.match(
    catalogWarning({ products: [{ id: 'proof-press', name: 'Proof Press', hidden: true }] }),
    /lists 1 product, every one marked hidden/,
    'one hidden product is a product, not products',
  );

  assert.match(catalogWarning({ products: [] }), /payment\.products is empty/, 'a bare catalog keeps its own wording');
  assert.match(catalogWarning(undefined), /payment\.products is empty/, 'and so does a missing payment section');
});

test('classy: a hidden product never reaches the pricing page (#348)', async () => {
  const pages = await buildWith({ ...miniData, payment: HIDDEN_QA });
  const html = pages.get('/pricing');
  // The client Configuration blob keeps the WHOLE catalog (checkout resolves
  // a hidden product by id) — the claim is about what the page RENDERS.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

  assert.ok(!markup.includes('Proof Press'), 'the hidden product name is nowhere on the page');
  assert.ok(!markup.includes('test prints, pulled immediately'), 'nor its tagline');
  assert.ok(!markup.includes('data-plan-id="proof-press"'), 'and it has no checkout button');
  assert.ok(markup.includes('data-plan-id="premium"'), 'the visible catalog still renders');
  assert.ok(html.includes('"id":"proof-press"'), 'while the client still resolves it by id');
});
