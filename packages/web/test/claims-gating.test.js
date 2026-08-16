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
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

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

test('#273: the framework defaults invent no refund window and no trial — checkout + alternative', async () => {
  const pages = await buildPages({ payment: NO_TRIAL, name: 'claims-default' });

  const checkout = pages.get('/payment/checkout');
  assert.ok(checkout, 'checkout page built');
  assert.ok(!/money-back guarantee/i.test(checkout), 'no invented money-back claim on the checkout page');
  assert.ok(!/\d+-day/.test(checkout), 'and no invented window beside it');

  const alternative = pages.get('/alternatives/competitorx');
  assert.ok(alternative, 'alternative page built');
  assert.ok(!/money-back guarantee/i.test(alternative), 'no invented money-back claim in the alternative FAQs');
  assert.ok(!/\d+[- ]days?/i.test(alternative), 'no invented window anywhere on the page (FAQ, hero, CTA)');
  assert.ok(!/free trial/i.test(alternative), 'no trial claim at all for a catalog without one');
  // What the framework DOES know still ships on both pages.
  assert.ok(/cancel/i.test(alternative), 'the honest cancellation answer stays');
  assert.ok(checkout.includes('SSL encrypted'), 'the trust foot keeps its real facts');
});

test('#273: a brand that states a guarantee gets the checkout line back, in its own words', async () => {
  const pages = await buildPages({
    payment: TRIAL,
    guarantee: 'Backed by our 30-day promise',
    name: 'claims-guarantee',
  });

  const checkout = pages.get('/payment/checkout');
  assert.ok(checkout.includes('Backed by our 30-day promise'), 'the checkout note renders the brand copy');
  assert.ok(/money-back guarantee/i.test(checkout), 'and the trust foot chip returns with it');

  const alternative = pages.get('/alternatives/competitorx');
  assert.ok(alternative.includes('Backed by our 30-day promise'), 'the alternative FAQ answers with the brand copy');
  assert.ok(/14-day free trial/.test(alternative), 'and the trial answer states the catalog\'s real number');
  assert.ok(alternative.includes('Try free for 14 days'), 'the hero CTA derives the same number');
  assert.ok(alternative.includes('Start free trial'), 'and the closing CTA speaks the trial again');
});

test('#273: the alternatives INDEX page states a trial only when the catalog sells one', async () => {
  // Two clicks on again: the index page listing the comparisons carried the
  // same hardcoded "Start your free trial today" / "Start free trial" CTA the
  // detail page dropped.
  const none = await buildPages({ payment: NO_TRIAL, name: 'claims-index-none' });
  const index = none.get('/alternatives');
  assert.ok(index, 'alternatives index built');
  assert.ok(!/free trial/i.test(index), 'no trial claim for a catalog without one');
  assert.ok(!/\d+[- ]days?/i.test(index), 'and no invented window with it');
  assert.ok(index.includes('Ready to make the switch?'), 'the closing CTA still ships');
  assert.ok(/Join thousands of happy users who chose [^<]*\.\s*</.test(index), 'its subheadline just stops after the honest sentence');

  const sold = await buildPages({ payment: TRIAL, name: 'claims-index-trial' });
  const withTrial = sold.get('/alternatives');
  assert.ok(withTrial.includes('Start your free trial today'), 'the catalog trial brings the CTA copy back');
  assert.ok(withTrial.includes('Start free trial'), 'and the button speaks it too');
});
