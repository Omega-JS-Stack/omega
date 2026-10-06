/**
 * #273, two clicks on from the pricing page: the SAME invented promises the
 * pricing defaults dropped were still hardcoded on the pages beside it — the
 * checkout page's "7-day money-back guarantee" (the subscription note and the
 * trust foot) and the alternative page's "full 14-day free trial" +
 * "30-day money-back guarantee" FAQ answers.
 *
 * A refund window is BRAND copy (`pricing.guarantee`), a trial is CATALOG data
 * (`resolved.pricing.trialDays`): the framework defaults state neither on its
 * own. Both pages are built from a bare consumer so the assertions read the
 * framework's own copy, not a fixture's.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const NO_TRIAL = { products: [{ id: 'pro', name: 'Pro', prices: { monthly: 20 } }] };
const TRIAL = { products: [{ id: 'pro', name: 'Pro', prices: { monthly: 20 }, trial: { days: 14 } }] };

/**
 * Build a bare consumer carrying one alternative doc, optionally with the
 * brand's own guarantee copy in the site-wide directory data.
 * @param {object} options
 * @param {object} options.payment - the catalog
 * @param {string} [options.guarantee] - brand guarantee copy (pricing.guarantee)
 * @param {string} options.name - output namespace
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildPages({ payment, guarantee, name }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-claims-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, '_alternatives'), { recursive: true });
  if (guarantee) {
    fs.writeFileSync(
      path.join(consumerDir, 'src.11tydata.json'),
      JSON.stringify({ pricing: { guarantee } }),
    );
  }
  fs.writeFileSync(path.join(consumerDir, '_alternatives', 'competitorx.md'), [
    '---',
    'layout: blueprint/alternatives/alternative',
    'alternative:',
    '  competitor:',
    '    name: "CompetitorX"',
    '---',
  ].join('\n'));

  try {
    return await buildSite(consumerDir, { ...bareData, payment }, {}, name);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'claims-gating',
  tests: [
    {
      name: '#273: the framework defaults invent no refund window and no trial — checkout + alternative',
      run: async (ctx) => {
        const pages = await buildPages({ payment: NO_TRIAL, name: 'claims-default' });

        const checkout = pages.get('/payment/checkout');
        ctx.expect(checkout, 'checkout page built').toBeTruthy();
        ctx.expect(!/money-back guarantee/i.test(checkout), 'no invented money-back claim on the checkout page').toBeTruthy();
        ctx.expect(!/\d+-day/.test(checkout), 'and no invented window beside it').toBeTruthy();

        const alternative = pages.get('/alternatives/competitorx');
        ctx.expect(alternative, 'alternative page built').toBeTruthy();
        ctx.expect(!/money-back guarantee/i.test(alternative), 'no invented money-back claim in the alternative FAQs').toBeTruthy();
        ctx.expect(!/\d+[- ]days?/i.test(alternative), 'no invented window anywhere on the page (FAQ, hero, CTA)').toBeTruthy();
        ctx.expect(!/free trial/i.test(alternative), 'no trial claim at all for a catalog without one').toBeTruthy();
        // What the framework DOES know still ships on both pages.
        ctx.expect(/cancel/i.test(alternative), 'the honest cancellation answer stays').toBeTruthy();
        ctx.expect(checkout.includes('SSL encrypted'), 'the trust foot keeps its real facts').toBeTruthy();
      },
    },

    {
      name: '#273: a brand that states a guarantee gets the checkout line back, in its own words',
      run: async (ctx) => {
        const pages = await buildPages({
          payment: TRIAL,
          guarantee: 'Backed by our 30-day promise',
          name: 'claims-guarantee',
        });

        const checkout = pages.get('/payment/checkout');
        ctx.expect(checkout.includes('Backed by our 30-day promise'), 'the checkout note renders the brand copy').toBeTruthy();
        ctx.expect(/money-back guarantee/i.test(checkout), 'and the trust foot chip returns with it').toBeTruthy();

        const alternative = pages.get('/alternatives/competitorx');
        ctx.expect(alternative.includes('Backed by our 30-day promise'), 'the alternative FAQ answers with the brand copy').toBeTruthy();
        ctx.expect(/14-day free trial/.test(alternative), 'and the trial answer states the catalog\'s real number').toBeTruthy();
        ctx.expect(alternative.includes('Try free for 14 days'), 'the hero CTA derives the same number').toBeTruthy();
        ctx.expect(alternative.includes('Start free trial'), 'and the closing CTA speaks the trial again').toBeTruthy();
      },
    },

    {
      name: '#273: the alternatives INDEX page states a trial only when the catalog sells one',
      run: async (ctx) => {
        // Two clicks on again: the index page listing the comparisons carried the
        // same hardcoded "Start your free trial today" / "Start free trial" CTA the
        // detail page dropped.
        const none = await buildPages({ payment: NO_TRIAL, name: 'claims-index-none' });
        const index = none.get('/alternatives');
        ctx.expect(index, 'alternatives index built').toBeTruthy();
        ctx.expect(!/free trial/i.test(index), 'no trial claim for a catalog without one').toBeTruthy();
        ctx.expect(!/\d+[- ]days?/i.test(index), 'and no invented window with it').toBeTruthy();
        ctx.expect(index.includes('Ready to make the switch?'), 'the closing CTA still ships').toBeTruthy();
        ctx.expect(/Join thousands of happy users who chose [^<]*\.\s*</.test(index), 'its subheadline just stops after the honest sentence').toBeTruthy();

        const sold = await buildPages({ payment: TRIAL, name: 'claims-index-trial' });
        const withTrial = sold.get('/alternatives');
        ctx.expect(withTrial.includes('Start your free trial today'), 'the catalog trial brings the CTA copy back').toBeTruthy();
        ctx.expect(withTrial.includes('Start free trial'), 'and the button speaks it too').toBeTruthy();
      },
    },
  ],
});
