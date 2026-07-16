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
const { test } = require('node:test');
const { composePricing } = require('../src/pricing.js');
const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

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

test('classy: monthly-only catalog hides the billing toggle', async () => {
  const pages = await buildWith({
    ...miniData,
    payment: { products: [{ id: 'solo', name: 'Solo', prices: { monthly: 5 } }] },
  });
  const html = pages.get('/pricing');
  assert.ok(!html.includes('name="billing"'), 'no toggle without both cadences');
  assert.ok(html.includes('data-plan-id="solo"'), 'plan still renders');
});

test('classy: marketing chrome defaults ship ON (Ian 2026-07-11 — social proof, testimonials, FAQs, enterprise)', async () => {
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const html = pages.get('/pricing');
  assert.ok(html.includes('5M'), 'default social proof');
  assert.ok(html.includes('Sarah Johnson'), 'default testimonials');
  assert.ok(html.includes('Can I cancel at any time?'), 'default FAQs');
  assert.ok(html.includes('data-plan-id="enterprise"'), 'enterprise card on by default');
  assert.ok(html.includes('7-day money-back guarantee'), 'guarantee line default');
});

test('classy: consumer frontmatter still overrides presentation (consumer surface)', async () => {
  // The mini fixture has no consumer pricing page — resolved.pricing comes
  // from the site seed; hero copy proves the template-default path.
  const pages = await buildWith({ ...miniData, payment: CATALOG });
  const html = pages.get('/pricing');
  assert.ok(html.includes('The right plans,'), 'template hero default');
  assert.ok(html.includes('for the right price'), 'template hero accent default');
});
