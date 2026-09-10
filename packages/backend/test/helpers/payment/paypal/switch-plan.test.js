/**
 * Test: PayPal switchPlan(), which TWIN a plan change revises onto
 * ([#761](https://github.com/Omega-JS-Stack/omega/issues/761)).
 *
 * The twin is a property of the TARGET product, not of the subscriber: a
 * trialing switcher carries the trial only when the product they move to
 * configures trial days, a paying switcher always lands on the no-trial twin,
 * and a trial-less product has one plan for everybody. The HTTP calls are the
 * one thing stubbed; the plan the revise is asked for is what is under test.
 *
 * Run: npx omega test backend:helpers/payment/paypal/switch-plan
 */
const provider = require('../../../../dist/manager/routes/payments/plan/providers/paypal.js');
const PayPal = require('../../../../dist/manager/libraries/payment/providers/paypal.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const TRIAL_PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', trial: { days: 7 }, prices: { monthly: 20 }, paypal: { productId: 'PROD-PREMIUM' } };
const PLAIN_PRODUCT = { id: 'proof-press', name: 'Proof Press', type: 'subscription', prices: { monthly: 5 }, paypal: { productId: 'PROD-PROOF' } };

const NOW = 1_700_000_000;
const TRIALING = { status: 'active', trial: { claimed: true, expires: { timestampUNIX: NOW } }, expires: { timestampUNIX: NOW } };
const PAYING = { status: 'active', trial: { claimed: false }, expires: { timestampUNIX: NOW + 86400 * 30 } };

function plan(id, amount, trialDays) {
  const cycles = [];

  if (trialDays > 0) {
    cycles.push({ tenure_type: 'TRIAL', sequence: 1, total_cycles: trialDays, frequency: { interval_unit: 'DAY', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } });
  }

  cycles.push({ tenure_type: 'REGULAR', sequence: cycles.length + 1, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: amount.toFixed(2), currency_code: 'USD' } } });

  return { id, status: 'ACTIVE', billing_cycles: cycles };
}

const PLANS = {
  'PROD-PREMIUM': [plan('P-PREMIUM-TRIAL', 20, 7), plan('P-PREMIUM', 20, 0)],
  'PROD-PROOF': [plan('P-PROOF', 5, 0)],
};

/** Run a switch against the fixed plan lists and return the plan id the revise asked for */
async function switchTo(product, subscription) {
  const realRequest = PayPal.request;
  let revised = null;

  PayPal.request = async (path, options) => {
    if (path.includes('/revise')) {
      revised = JSON.parse(options.body).plan_id;
      return {};
    }
    const productId = new URL(`https://x${path}`).searchParams.get('product_id');
    return { plans: JSON.parse(JSON.stringify(PLANS[productId] || [])) };
  };

  try {
    await provider.switchPlan({ resourceId: 'I-TEST', uid: '_test-switcher', subscription, product, frequency: 'monthly', ctx: { log() {} } });
  } finally {
    PayPal.request = realRequest;
  }

  return revised;
}

module.exports = defineCases({
  description: 'PayPal switchPlan(): the twin a plan change lands on',
  type: 'group',

  tests: [
    {
      name: 'a-trialing-switcher-carries-the-trial-onto-a-trial-products-trial-twin',
      async run({ assert }) {
        assert.equal(await switchTo(TRIAL_PRODUCT, TRIALING), 'P-PREMIUM-TRIAL', 'The trial rides over');
      },
    },

    {
      name: 'a-paying-switcher-lands-on-the-no-trial-twin',
      async run({ assert }) {
        assert.equal(await switchTo(TRIAL_PRODUCT, PAYING), 'P-PREMIUM', 'No free cycle for a paying customer');
      },
    },

    {
      name: 'a-trialing-switcher-onto-a-trial-less-product-takes-its-one-plan',
      async run({ assert }) {
        // No manage run will ever mint a trial twin for a product with no trial
        // days, so asking for one would 500 every such switch
        assert.equal(await switchTo(PLAIN_PRODUCT, TRIALING), 'P-PROOF', 'The trial ends; the switch still works');
      },
    },
  ],
});
