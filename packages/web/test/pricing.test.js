/**
 * C2 pricing — payment.products is the ONLY pricing source.
 *
 * Unit half: composePricing's view-model contract (plan/one-time split,
 * free detection, the FEATURES CATALOG supplying row order/name/icon/definition
 * while each product names only its value, -1 → Unlimited, common/extra
 * features, comparison inheritance, billing-toggle availability, honest
 * savings %). A feature is defined ONCE
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)), so there is
 * nothing left to backfill.
 *
 * Integration half: the packaged themes render /pricing from config alone —
 * plans from the catalog, one-time section per type (friction #7), the honest
 * empty state on a bare catalog (friction #6), and zero dispersal-era
 * fiction (Plus/Pro/Max, fake social proof) anywhere in the output.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { composePricing } = require('../src/pricing.js');
const { catalogWarning } = require('../src/commands/build.js');
const { buildSite, buildWith: sharedBuildWith, readBuildJson, miniData, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'pricing-test');

// The top-level `features` catalog: every feature DEFINED once, in the order
// every surface renders it. `requests` is counted (it carries a `usage` block);
// `support` is a perk.
const FEATURES = {
  requests: { name: 'Requests', icon: 'sparkles', definition: 'API requests per month.', usage: {} },
  proofs: { name: 'Proof pulls', icon: 'flask', usage: {} },
  support: { name: 'Priority support', icon: 'headset' },
  sso: { name: 'SSO & provisioning', icon: 'key' },
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
    {
      id: 'launch-kit',
      name: 'Launch Kit',
      type: 'one-time',
      tagline: 'everything to ship day one',
      prices: { once: 49.99 },
    },
  ],
};

/** Heading levels inside <main>, in document order. @returns {number[]} */
function headingLevels(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

// #273 — the defaults shipped a "7-day money-back guarantee" line beside a
// "14-day free trial" FAQ answer: contradictory, and both invented for any
// catalog. Trial copy now derives from the catalog (rendered only when it has
// one), and the refund claims are gone — a refund policy is brand copy.
const NO_TRIAL = { products: CATALOG.products.map((product) => ({ ...product, trial: undefined })) };

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
      features: { sso: true },
    },
  ],
};

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
      features: { proofs: 5 },
    },
  ],
};

module.exports = defineCases({
  type: 'group',
  description: 'pricing',
  tests: [
    {
      name: 'composePricing: subscription/one-time split, free detection, values from the catalog',
      run: (ctx) => {
        const pricing = composePricing(CATALOG, FEATURES);

        ctx.expect(pricing.plans.length, 'one-time products stay out of the plan grid').toBe(2);
        ctx.expect(pricing.oneTime.length).toBe(1);

        const [basic, premium] = pricing.plans;
        ctx.expect(basic.free, 'no prices → free').toBe(true);
        ctx.expect(basic.url, 'free plans default to the signup CTA').toBe('/signup');
        ctx.expect(basic.features[0].value, "the product names the counted feature's number").toBe(100);
        ctx.expect(basic.features[0].name, 'the name comes from the catalog').toBe('Requests');
        ctx.expect(basic.features[0].icon, 'so does the icon').toBe('sparkles');
        ctx.expect(basic.features[0].definition).toBe('API requests per month.');

        ctx.expect(premium.free).toBe(false);
        ctx.expect(premium.url, 'paid plans without a url get a checkout button').toBe(null);
        ctx.expect(premium.popular).toBe(true);
        ctx.expect(premium.trialDays).toBe(14);
        ctx.expect(premium.prices.annuallyPerMonth, '99.99/12 floors for the card display').toBe(8);
        ctx.expect(premium.features[0].value, '-1 renders as Unlimited').toBe('Unlimited');
        ctx.expect(premium.features[1].value, 'a perk value renders as a check').toBe(true);

        const kit = pricing.oneTime[0];
        ctx.expect(kit.price).toBe(49.99);
        ctx.expect(kit.tagline).toBe('everything to ship day one');
      },
    },

    {
      name: 'composePricing: one definition, every card — the catalog is the only home',
      run: (ctx) => {
        const pricing = composePricing(CATALOG, FEATURES);
        const [, premium] = pricing.plans;

        // No product carries copy any more, so every plan card (not just the first)
        // renders the dotted tooltip from the ONE definition the catalog holds
        ctx.expect(premium.features[0].definition).toBe('API requests per month.');
        ctx.expect(premium.commonFeatures.find((f) => f.id === 'requests').definition, 'the common/extra split keeps the catalog copy').toBe('API requests per month.');
      },
    },

    {
      name: 'composePricing: a value of false is not a promise — the tier omits the row',
      run: (ctx) => {
        const pricing = composePricing({
          products: [
            { id: 'basic', name: 'Basic', features: { requests: 10, support: false } },
            { id: 'premium', name: 'Premium', prices: { monthly: 5 }, features: { requests: 20, support: true } },
          ],
        }, FEATURES);

        ctx.expect(pricing.plans[0].features.map((f) => f.id), 'false renders nowhere').toEqual(['requests']);
        ctx.expect(pricing.plans[1].features.map((f) => f.id)).toEqual(['requests', 'support']);
      },
    },

    {
      name: 'composePricing: row order is CATALOG order, not the order a product listed them',
      run: (ctx) => {
        const pricing = composePricing({
          products: [{ id: 'p', name: 'P', features: { support: true, requests: 5 } }],
        }, FEATURES);

        ctx.expect(pricing.plans[0].features.map((f) => f.id)).toEqual(['requests', 'support']);
      },
    },

    {
      name: 'composePricing: products with no catalog behind them render no bullets, never invented copy',
      run: (ctx) => {
        const pricing = composePricing({ products: [{ id: 'p', name: 'P', features: { requests: 5 } }] });

        ctx.expect(pricing.plans[0].features).toEqual([]);
      },
    },

    {
      name: 'composePricing: the pre-#647 features LIST fails loudly, never a silently empty matrix',
      run: (ctx) => {
        ctx.expect(() => composePricing({
            products: [{ id: 'basic', name: 'Basic', features: [{ id: 'requests', name: 'Requests', value: 100 }] }],
          }, FEATURES), 'the message names the product and the migration').toThrow(/"basic" carries the pre-#647 features LIST.*define each feature ONCE in the top-level `features` catalog/s);
      },
    },

    {
      name: 'composePricing: common/extra split + comparison inheritance',
      run: (ctx) => {
        const pricing = composePricing(CATALOG, FEATURES);
        const [basic, premium] = pricing.plans;

        ctx.expect(basic.commonFeatures.map((f) => f.id), 'requests is in every plan').toEqual(['requests']);
        ctx.expect(premium.extraFeatures.map((f) => f.id), 'support is premium-only').toEqual(['support']);

        const support = pricing.comparison.features.find((f) => f.id === 'support');
        ctx.expect(support.values.basic, 'basic genuinely lacks support (no earlier plan to inherit from)').toBe(null);
        ctx.expect(support.values.premium).toBe(true);

        const requests = pricing.comparison.features.find((f) => f.id === 'requests');
        ctx.expect(requests.values.basic).toBe(100);
        ctx.expect(requests.values.premium).toBe('Unlimited');
      },
    },

    {
      name: 'composePricing: comparison values inherit from earlier tiers',
      run: (ctx) => {
        const pricing = composePricing({
          products: [
            { id: 'a', name: 'A', features: { x: 10 } },
            { id: 'b', name: 'B', prices: { monthly: 5 }, features: { y: true } },
          ],
        }, { x: { name: 'X', usage: {} }, y: { name: 'Y' } });
        const x = pricing.comparison.features.find((f) => f.id === 'x');
        ctx.expect(x.values.b, 'b inherits x from a (tiers accumulate)').toBe(10);
      },
    },

    {
      name: 'composePricing: billing availability + honest savings badge',
      run: (ctx) => {
        const both = composePricing(CATALOG, FEATURES);
        ctx.expect(both.billing).toEqual({ monthly: true, annually: true });
        ctx.expect(both.savingsPercent, '99.99 vs 9.99*12 → 17%').toBe(17);

        const monthlyOnly = composePricing({ products: [{ id: 'p', name: 'P', prices: { monthly: 5 } }] });
        ctx.expect(monthlyOnly.billing, 'no toggle without both cadences').toEqual({ monthly: true, annually: false });
        ctx.expect(monthlyOnly.savingsPercent).toBe(0);
      },
    },

    {
      name: 'composePricing: empty/absent catalog → null (honest empty state)',
      run: (ctx) => {
        ctx.expect(composePricing(undefined)).toBe(null);
        ctx.expect(composePricing({})).toBe(null);
        ctx.expect(composePricing({ products: [] })).toBe(null);
      },
    },

    {
      name: 'composePricing: untyped products default to subscription',
      run: (ctx) => {
        const pricing = composePricing({ products: [{ id: 'p', name: 'P' }] });
        ctx.expect(pricing.plans.length).toBe(1);
      },
    },

    // #477 — the card's "$N /month" under the annual toggle ROUNDED where the
    // fleet's legacy renders floored, so the same catalog priced a plan $1 higher
    // than the brand had shipped for years. The rule is flooring: a monthly
    // equivalent never claims more than a twelfth of what is charged.
    {
      name: 'composePricing: the monthly equivalent FLOORS, never rounds up (#477)',
      run: (ctx) => {
        const pricing = composePricing({
          products: [
            { id: 'team', name: 'Team', prices: { monthly: 79, annually: 790 } },
            { id: 'scale', name: 'Scale', prices: { monthly: 199, annually: 1990 } },
          ],
        });
        const [team, scale] = pricing.plans;

        ctx.expect(team.prices.annuallyPerMonth, '790/12 = 65.83 → $65, as the legacy renders showed').toBe(65);
        ctx.expect(scale.prices.annuallyPerMonth, '1990/12 = 165.83 → $165').toBe(165);
      },
    },

    ...(() => {
      const cases = [];
      for (const theme of ['classy', 'neobrutalism', 'newsflash']) {
        cases.push({
          name: `${theme}: /pricing renders from the catalog alone (plans, one-time, checkout wiring)`,
          run: async (ctx) => {
            const pages = await buildWith({ ...miniData, payment: CATALOG }, { activeTheme: theme });
            const html = pages.get('/pricing');

            // Plans from config
            ctx.expect(html.includes('Basic'), `${theme}: catalog plan name`).toBeTruthy();
            ctx.expect(html.includes('Premium'), `${theme}: catalog plan name`).toBeTruthy();
            ctx.expect(html.includes('best for teams'), `${theme}: product tagline`).toBeTruthy();
            ctx.expect(!html.includes('>Plus<') && !html.includes('>Pro<') && !html.includes('>Max<'), `${theme}: no fictional plans`).toBeTruthy();

            // Prices + checkout wiring
            ctx.expect(html.includes('data-plan-id="premium"'), `${theme}: paid plan checkout button`).toBeTruthy();
            ctx.expect(html.includes('data-plan-type="subscription"'), `${theme}: type attribute for frequency logic`).toBeTruthy();
            ctx.expect(html.includes('data-monthly="9.99"'), `${theme}: monthly price data attribute`).toBeTruthy();
            ctx.expect(html.includes('Get free trial'), `${theme}: trial CTA from product.trial.days`).toBeTruthy();
            ctx.expect(html.includes('href="/signup"'), `${theme}: free plan anchors to signup`).toBeTruthy();

            // One-time products get their own presentation (friction #7)
            ctx.expect(html.includes('Launch Kit'), `${theme}: one-time product rendered`).toBeTruthy();
            ctx.expect(html.includes('data-plan-type="one-time"'), `${theme}: one-time checkout type`).toBeTruthy();
            ctx.expect(html.includes('49.99'), `${theme}: one-time price`).toBeTruthy();

            // Savings badge computes from real prices; marketing chrome ships ON by
            // default (Ian 2026-07-11: banner/social proof/FAQ defaults are product
            // behavior — only PLAN fiction is dead)
            ctx.expect(html.includes('17%'), `${theme}: computed savings badge`).toBeTruthy();
            ctx.expect(html.includes('WELCOME15'), `${theme}: promo banner on by default`).toBeTruthy();
            ctx.expect(html.includes('id="pricing-promo-banner"'), `${theme}: banner markup present`).toBeTruthy();

            // The banner is NAV chrome (#764): closing it hands the nav its margin
            // back and touches nothing else — the page never moved for it, so there is
            // no page padding to put back.
            const closeHandler = /onclick="([^"]*pricing-promo-banner[^"]*)"/.exec(html)[1];
            ctx.expect(closeHandler.includes('.omega-nav'), `${theme}: close resets the nav push`).toBeTruthy();
            ctx.expect(!closeHandler.includes('paddingTop'), `${theme}: close touches no section padding`).toBeTruthy();
          },
        });

        cases.push({
          name: `${theme}: bare catalog → honest empty state (friction #6)`,
          run: async (ctx) => {
            const pages = await buildWith({ ...miniData, payment: undefined }, { activeTheme: theme });
            const html = pages.get('/pricing');

            ctx.expect(!html.includes('data-plan-id='), `${theme}: no plan buttons`).toBeTruthy();
            ctx.expect(!html.includes('>Basic<') && !html.includes('>Plus<'), `${theme}: no plans at all`).toBeTruthy();
            ctx.expect(html.includes('id="pricing-empty"'), `${theme}: explicit empty state`).toBeTruthy();
            ctx.expect(!html.includes('name="billing"'), `${theme}: no billing toggle`).toBeTruthy();
          },
        });
      }
      return cases;
    })(),

    {
      name: 'wave-3 W5: out-of-order catalog warns (comparison inherits by catalog order)',
      run: (ctx) => {
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
          ctx.expect(warnings.length, 'non-monotonic prices warn').toBe(1);
          ctx.expect(warnings[0].includes('"basic"') && warnings[0].includes('"pro"'), 'names both plans').toBeTruthy();

          warnings.length = 0;
          composePricing({
            products: [
              { id: 'basic', name: 'Basic', prices: { monthly: 5 } },
              { id: 'pro', name: 'Pro', prices: { monthly: 20 } },
            ],
          });
          ctx.expect(warnings.length, 'ascending catalog stays silent').toBe(0);
        } finally {
          console.warn = original;
        }
      },
    },

    {
      name: 'classy: monthly-only catalog hides the billing toggle',
      run: async (ctx) => {
        const pages = await buildWith({
          ...miniData,
          payment: { products: [{ id: 'solo', name: 'Solo', prices: { monthly: 5 } }] },
        });
        const html = pages.get('/pricing');
        ctx.expect(!html.includes('name="billing"'), 'no toggle without both cadences').toBeTruthy();
        ctx.expect(html.includes('data-plan-id="solo"'), 'plan still renders').toBeTruthy();
      },
    },

    {
      name: 'classy: marketing chrome defaults ship ON (Ian 2026-07-11 — social proof, testimonials, FAQs)',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: CATALOG });
        const html = pages.get('/pricing');
        ctx.expect(html.includes('5M'), 'default social proof').toBeTruthy();
        ctx.expect(html.includes('Sarah Johnson'), 'default testimonials').toBeTruthy();
        ctx.expect(html.includes('Can I cancel at any time?'), 'default FAQs').toBeTruthy();
        // The guarantee line is brand copy now (#273) — it renders only for a brand
        // that states one, and never invents a refund window.
        ctx.expect(!html.includes('omega-guarantee-icon'), 'no guarantee line without brand copy').toBeTruthy();
      },
    },

    // The brand-copy lane for the guarantee (#273): the site-wide directory-data
    // layer, which deep-merges over the engine-composed resolved.pricing.
    {
      name: '#273: a brand that states a guarantee gets the line back',
      run: async (ctx) => {
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
          ctx.expect(html.includes('Backed by our 30-day promise'), 'the brand-stated guarantee renders').toBeTruthy();
          ctx.expect(html.includes('omega-guarantee-icon'), 'with its shield').toBeTruthy();
          // Same gate for the FAQ aside's decoration of that promise (#273).
          ctx.expect(/money-back guarantee/i.test(html), 'the FAQ aside chip comes back with it').toBeTruthy();
          ctx.expect(/refunded/i.test(html), 'and so does the refund fragment').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'composePricing: the enterprise product leaves the grid (issue #44 item 8)',
      run: (ctx) => {
        const pricing = composePricing({
          products: [
            ...CATALOG.products,
            { id: 'enterprise', name: 'Bindery', enterprise: true, tagline: 'for organizations', features: { sso: true } },
          ],
        }, FEATURES);

        ctx.expect(pricing.plans.length, 'the enterprise tier is not a plan card').toBe(2);
        ctx.expect(!pricing.comparison.features.some((f) => f.id === 'sso'), 'nor a comparison column').toBeTruthy();
        ctx.expect(pricing.enterprise.name).toBe('Bindery');
        ctx.expect(pricing.enterprise.tagline).toBe('for organizations');
        ctx.expect(pricing.enterprise.url, 'contact CTA by default').toBe('/contact');
        ctx.expect(pricing.enterprise.features.map((f) => f.name)).toEqual(['SSO & provisioning']);

        ctx.expect(composePricing(CATALOG, FEATURES).enterprise, 'no enterprise product → nothing to render').toBe(null);
      },
    },

    {
      name: 'composePricing: the enterprise flag wins over the type — one product, one lane',
      run: (ctx) => {
        const pricing = composePricing({
          products: [
            ...CATALOG.products,
            { id: 'partnership', name: 'Partnership', type: 'one-time', enterprise: true, prices: { once: 5000 } },
          ],
        });

        ctx.expect(pricing.oneTime.map((p) => p.id), 'an enterprise-flagged one-time product leaves the one-time grid too').toEqual(['launch-kit']);
        ctx.expect(pricing.enterprise.id, 'it renders as the enterprise row, once').toBe('partnership');
      },
    },

    {
      name: 'classy: the enterprise row renders only when the catalog declares it (issue #44 item 8)',
      run: async (ctx) => {
        const withEnterprise = await buildWith({
          ...miniData,
          features: FEATURES,
          payment: {
            products: [
              ...CATALOG.products,
              {
                id: 'enterprise',
                name: 'Bindery',
                enterprise: true,
                tagline: 'for organizations that need their own terms',
                url: '/contact',
                features: { sso: true },
              },
            ],
          },
        });
        const html = withEnterprise.get('/pricing');

        ctx.expect(html.includes('omega-band--enterprise'), 'its own full-width row, not a card').toBeTruthy();
        ctx.expect(html.includes('Bindery'), 'plan name from the catalog').toBeTruthy();
        ctx.expect(html.includes('for organizations that need their own terms'), 'the one-line pitch').toBeTruthy();
        ctx.expect(html.includes('SSO & provisioning'), 'the feature list').toBeTruthy();
        ctx.expect(html.includes('data-plan-enterprise="enterprise"'), 'contact CTA (a link, not a checkout button)').toBeTruthy();
        ctx.expect(!html.includes('data-plan-id="enterprise"'), 'never a card in the grid').toBeTruthy();

        const without = await buildWith({ ...miniData, features: FEATURES, payment: CATALOG });
        ctx.expect(!without.get('/pricing').includes('omega-band--enterprise'), 'no enterprise in the data → no row').toBeTruthy();
      },
    },

    ...(() => {
      const cases = [];
      // Neither partial theme forks a pricing layout (#177 phases 2 + 3): their
      // /pricing renders the BASE page, so the enterprise strip wears the base
      // omega-band idiom and the comparison table returns with the base page.
      for (const theme of ['neobrutalism', 'newsflash']) {
        cases.push({
          name: `${theme}: /pricing falls through to the base page; enterprise rides the omega-band idiom (#177)`,
          run: async (ctx) => {
            const withEnterprise = await buildWith({
              ...miniData,
              features: FEATURES,
              payment: {
                products: [
                  ...CATALOG.products,
                  {
                    id: 'enterprise',
                    name: 'Bindery',
                    enterprise: true,
                    tagline: 'for organizations that need their own terms',
                    url: '/contact',
                    features: { sso: true },
                  },
                ],
              },
            }, { activeTheme: theme });
            const html = withEnterprise.get('/pricing');

            ctx.expect(html.includes('omega-band--enterprise'), `${theme}: the base full-width row serves`).toBeTruthy();
            ctx.expect(html.includes('Bindery'), `${theme}: plan name from the catalog`).toBeTruthy();
            ctx.expect(html.includes('for organizations that need their own terms'), `${theme}: the one-line pitch`).toBeTruthy();
            ctx.expect(html.includes('SSO & provisioning'), `${theme}: the feature list`).toBeTruthy();
            ctx.expect(html.includes('data-plan-enterprise="enterprise"'), `${theme}: contact CTA (a link, not a checkout button)`).toBeTruthy();
            ctx.expect(html.includes('href="/contact"'), `${theme}: the CTA points at the product url`).toBeTruthy();
            ctx.expect(!html.includes('data-plan-id="enterprise"'), `${theme}: never a card in the grid`).toBeTruthy();
            ctx.expect(html.includes('omega-compare'), `${theme}: the feature-comparison table returns with the base page`).toBeTruthy();

            // The invented copy the old always-on strip carried is gone
            ctx.expect(!html.includes('Custom solutions for large organizations'), `${theme}: no fictional enterprise blurb`).toBeTruthy();
            ctx.expect(!html.includes('Bulk memberships for companies'), `${theme}: no fictional group-access blurb`).toBeTruthy();

            const without = await buildWith({ ...miniData, features: FEATURES, payment: CATALOG }, { activeTheme: theme });
            ctx.expect(!without.get('/pricing').includes('data-plan-enterprise'), `${theme}: no enterprise in the data → no strip`).toBeTruthy();
            ctx.expect(!without.get('/pricing').includes('>Enterprise<'), `${theme}: nor its heading`).toBeTruthy();
          },
        });
      }
      return cases;
    })(),

    {
      name: 'classy: consumer frontmatter still overrides presentation (consumer surface)',
      run: async (ctx) => {
        // The mini fixture has no consumer pricing page — resolved.pricing comes
        // from the site seed; hero copy proves the template-default path.
        const pages = await buildWith({ ...miniData, payment: CATALOG });
        const html = pages.get('/pricing');
        ctx.expect(html.includes('The right plans,'), 'template hero default').toBeTruthy();
        ctx.expect(html.includes('for the right price'), 'template hero accent default').toBeTruthy();
      },
    },

    // #471 — /pricing renders its FAQ head INLINE (the aside embeds the bespoke
    // guarantee object), and the inline call forwarded no headline_accent: the
    // same faqs copy that renders whole through marketing/faq on /contact lost
    // its tail here, so one brand needed two spellings of one thing.
    {
      name: '#471: the pricing FAQ head forwards headline_accent, same data shape as /contact',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-faq-accent-'));
        const consumerDir = path.join(tmp, 'src');
        fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
        fs.writeFileSync(
          path.join(consumerDir, 'src.11tydata.json'),
          JSON.stringify({ faqs: { headline: 'Billing,', headline_accent: 'in plain words' } }),
        );
        fs.writeFileSync(
          path.join(consumerDir, 'pages', 'pricing.md'),
          ['---', 'layout: blueprint/pricing', 'permalink: /pricing', '---', ''].join('\n'),
        );

        try {
          const pages = await buildSite(consumerDir, { ...bareData, payment: CATALOG }, {}, 'pricing-faq-accent');
          const html = pages.get('/pricing');
          ctx.expect(html.includes('Billing,'), 'the brand headline reaches the inline head').toBeTruthy();
          ctx.expect(html.includes('<em>in plain words</em>'), 'and so does its accent, on the shared <em> mechanism').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // #270 — the cards band is the SHELL's, not the consumer page's, so every
    // brand on the blueprint shipped the same skip: the h1 was followed straight
    // by the h3 card names with no h2 between them.
    {
      name: '#270: the pricing shell never skips a heading level (h1 → h3)',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: CATALOG });
        const levels = headingLevels(pages.get('/pricing'));

        ctx.expect(levels[0], 'the page opens on its single h1').toBe(1);
        ctx.expect(levels[1], 'the cards band carries an h2 under it').toBe(2);
        levels.forEach((level, i) => {
          if (i === 0) return;
          ctx.expect(level <= levels[i - 1] + 1, `heading ${i} (h${level}) does not skip past h${levels[i - 1]}`).toBeTruthy();
        });

        const html = pages.get('/pricing');
        ctx.expect(/<h2 class="visually-hidden">/.test(html), 'the band heading is visually hidden — the design is unchanged').toBeTruthy();
      },
    },

    {
      name: '#273: the trial FAQ derives from the catalog — a 14-day trial states 14 days',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: CATALOG });
        const html = pages.get('/pricing');

        ctx.expect(html.includes('Is there a free trial?'), 'the trial FAQ renders for a catalog that has one').toBeTruthy();
        ctx.expect(/14-day free trial/.test(html), 'and states the catalog\'s real number').toBeTruthy();
        ctx.expect(!/\d+-day money-back guarantee/.test(html), 'no invented money-back guarantee anywhere').toBeTruthy();
        ctx.expect(!html.includes('What is your refund policy?'), 'no invented refund policy in the framework defaults').toBeTruthy();

        // The FAQ aside's decorative twins are the same claim in chrome — a refund
        // promise the framework cannot make for a brand.
        ctx.expect(!/money-back guarantee/i.test(html), 'no money-back chip in the FAQ aside').toBeTruthy();
        ctx.expect(!/refunded/i.test(html), 'no refund fragment in the FAQ aside').toBeTruthy();
        // What the framework DOES know still ships: the plan-switch route prorates.
        ctx.expect(html.includes('prorated'), 'the proration behavior is real product copy and stays').toBeTruthy();
      },
    },

    {
      name: '#273: a catalog with no trial renders no trial copy at all',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: NO_TRIAL });
        const html = pages.get('/pricing');

        ctx.expect(!html.includes('Is there a free trial?'), 'no trial in the catalog → no trial FAQ').toBeTruthy();
        ctx.expect(!/free trial/i.test(html), 'and no trial claim anywhere on the page').toBeTruthy();
        ctx.expect(html.includes('Can I cancel at any time?'), 'the honest defaults still ship').toBeTruthy();

        const schema = JSON.parse(html.match(/<script id="omega-schema-faq-page"[^>]*>([\s\S]*?)<\/script>/)[1]);
        ctx.expect(schema.mainEntity.every((entry) => entry.acceptedAnswer.text.trim() !== ''), 'the FAQPage schema carries no empty answers').toBeTruthy();
      },
    },

    {
      name: 'composePricing: the universal trial number needs unanimity among paid plans',
      run: (ctx) => {
        ctx.expect(composePricing(MIXED_TRIALS).trialDays, 'paid plans disagreeing → no number the page can speak').toBe(0);
        ctx.expect(composePricing(UNIFORM_TRIALS).trialDays, 'every paid plan on 14 days → 14').toBe(14);
        ctx.expect(composePricing(CATALOG, FEATURES).trialDays, 'a free plan carries no trial to disagree with — the paid plans decide').toBe(14);
        ctx.expect(composePricing(NO_TRIAL).trialDays, 'no trial anywhere → 0').toBe(0);
      },
    },

    {
      name: '#273 follow-up: a mixed-trial catalog claims no universal trial',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: MIXED_TRIALS });
        const html = pages.get('/pricing');

        ctx.expect(!html.includes('Is there a free trial?'), 'paid plans disagree → no trial FAQ').toBeTruthy();
        ctx.expect(!/\d+-day free trial/.test(html), 'and no universal trial claim anywhere').toBeTruthy();
        // The per-plan truth is untouched: the plan that HAS a trial still says so.
        ctx.expect(html.includes('Get free trial'), 'the trialing plan keeps its own CTA').toBeTruthy();

        const uniform = await buildWith({ ...miniData, payment: UNIFORM_TRIALS }, {}, 'pricing-uniform-trial');
        const uniformHtml = uniform.get('/pricing');
        ctx.expect(uniformHtml.includes('Is there a free trial?'), 'a catalog that agrees keeps the FAQ').toBeTruthy();
        ctx.expect(/14-day free trial/.test(uniformHtml), 'and states the shared number').toBeTruthy();
      },
    },

    {
      name: '#270 follow-up: an enterprise-only catalog never skips a heading level',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: ENTERPRISE_ONLY }, {}, 'pricing-enterprise-only');
        const html = pages.get('/pricing');
        const levels = headingLevels(html);

        ctx.expect(html.includes('omega-band--enterprise'), 'the enterprise row is the only band on the page').toBeTruthy();
        ctx.expect(levels[0], 'the page opens on its single h1').toBe(1);
        ctx.expect(levels[1], 'the enterprise band carries an h2 under it').toBe(2);
        levels.forEach((level, i) => {
          if (i === 0) return;
          ctx.expect(level <= levels[i - 1] + 1, `heading ${i} (h${level}) does not skip past h${levels[i - 1]}`).toBeTruthy();
        });
      },
    },

    {
      name: 'composePricing: a hidden product leaves every rendered lane (#348)',
      run: (ctx) => {
        const pricing = composePricing(HIDDEN_QA);

        ctx.expect(pricing.plans.map((plan) => plan.id), 'not a plan card').toEqual(['basic', 'premium']);
        ctx.expect(!pricing.comparison.features.some((feature) => feature.id === 'proofs'), 'nor a comparison row').toBeTruthy();
        ctx.expect(pricing.trialDays, 'nor a vote on the universal trial number (a trial-free QA tier would zero it)').toBe(14);

        const hiddenOneTime = composePricing({
          products: [...CATALOG.products, { id: 'qa-pack', name: 'QA Pack', type: 'one-time', hidden: true, prices: { once: 5 } }],
        });
        ctx.expect(hiddenOneTime.oneTime.map((product) => product.id), 'nor a one-time card').toEqual(['launch-kit']);

        const hiddenEnterprise = composePricing({
          products: [...CATALOG.products, { id: 'qa-terms', name: 'QA Terms', enterprise: true, hidden: true }],
        });
        ctx.expect(hiddenEnterprise.enterprise, 'nor the enterprise row').toBe(null);

        ctx.expect(composePricing({ products: [{ id: 'proof-press', name: 'Proof Press', hidden: true, prices: { monthly: 5 } }] }), 'a catalog of nothing but hidden products renders the honest empty state').toBe(null);
      },
    },

    {
      name: "`omega build`'s empty-catalog warning counts the VISIBLE catalog (#348)",
      run: (ctx) => {
        ctx.expect(catalogWarning(CATALOG), 'a catalog with cards warns about nothing').toBe(null);
        ctx.expect(catalogWarning(HIDDEN_QA), 'nor does one that merely CONTAINS a hidden product').toBe(null);

        // The page renders #pricing-empty here, so the build must say so — and say
        // WHICH config state it is, or the reader hunts a catalog that is not bare.
        const allHidden = catalogWarning({
          products: [
            { id: 'proof-press', name: 'Proof Press', hidden: true, prices: { monthly: 5 } },
            { id: 'qa-pack', name: 'QA Pack', type: 'one-time', hidden: true, prices: { once: 5 } },
          ],
        });
        ctx.expect(allHidden, 'an all-hidden catalog warns, named for what it is').toMatch(/lists 2 products, every one marked hidden/);
        ctx.expect(allHidden, 'and says what the page renders').toMatch(/empty state/);
        ctx.expect(catalogWarning({ products: [{ id: 'proof-press', name: 'Proof Press', hidden: true }] }), 'one hidden product is a product, not products').toMatch(/lists 1 product, every one marked hidden/);

        ctx.expect(catalogWarning({ products: [] }), 'a bare catalog keeps its own wording').toMatch(/payment\.products is empty/);
        ctx.expect(catalogWarning(undefined), 'and so does a missing payment section').toMatch(/payment\.products is empty/);
      },
    },

    {
      name: 'classy: a hidden product never reaches the pricing page (#348)',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, payment: HIDDEN_QA });
        const html = pages.get('/pricing');
        // The claim is about what the page RENDERS: the config the browser reads is
        // the run's ONE `build.js` snapshot (#894), never an inline blob on the page,
        // so the markup is read with its scripts stripped and the catalog is read out
        // of the snapshot the chrome loads.
        const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
        const products = readBuildJson(pages).config.payment.products;

        ctx.expect(!markup.includes('Proof Press'), 'the hidden product name is nowhere on the page').toBeTruthy();
        ctx.expect(!markup.includes('test prints, pulled immediately'), 'nor its tagline').toBeTruthy();
        ctx.expect(!markup.includes('data-plan-id="proof-press"'), 'and it has no checkout button').toBeTruthy();
        ctx.expect(markup.includes('data-plan-id="premium"'), 'the visible catalog still renders').toBeTruthy();
        // The snapshot keeps the WHOLE catalog, hidden products included: checkout
        // resolves one by id, so the client needs it even though no card renders it.
        ctx.expect(products.some((product) => product.id === 'proof-press'), 'while the client still resolves it by id').toBeTruthy();
        ctx.expect(!html.includes('"id":"proof-press"'), 'and the page bakes no second copy of the catalog').toBeTruthy();
      },
    },
  ],
});
