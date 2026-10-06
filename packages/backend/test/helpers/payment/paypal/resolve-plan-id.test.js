/**
 * Test: PayPal resolvePlanId(), which TWIN a checkout subscribes to
 * ([#761](https://github.com/Omega-JS-Stack/omega/issues/761)).
 *
 * PayPal puts a trial on the PLAN, never on the subscribe call, so the manager's
 * payment walk mints two active plans per interval on a product that configures
 * trial days: the trial twin (TRIAL cycle + REGULAR) and the skip-trial twin
 * (REGULAR only). Matching by interval + amount alone picked whichever came back
 * first, which is how a buyer who was refused a trial still got a free cycle.
 *
 * The HTTP call is the one thing stubbed (a real plan list needs live PayPal
 * credentials); the matching is what is under test.
 *
 * Run: npx omega test backend:helpers/payment/paypal/resolve-plan-id
 */
const PayPal = require('../../../../dist/omega/libraries/payment/providers/paypal.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', trial: { days: 7 }, prices: { monthly: 20 }, paypal: { productId: 'PROD-TEST' } };

/** A monthly plan for PROD-TEST, with or without the TRIAL cycle ahead of the REGULAR one */
function plan(id, trialDays) {
  const cycles = [];

  if (trialDays > 0) {
    cycles.push({ tenure_type: 'TRIAL', sequence: 1, total_cycles: trialDays, frequency: { interval_unit: 'DAY', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } });
  }

  cycles.push({ tenure_type: 'REGULAR', sequence: cycles.length + 1, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '20.00', currency_code: 'USD' } } });

  return { id, status: 'ACTIVE', billing_cycles: cycles };
}

// The trial twin FIRST, so a match on interval + amount alone would pick it
const BOTH_TWINS = [plan('P-TRIAL', 7), plan('P-NO-TRIAL', 0)];

/** Resolve against a fixed plan list, with the library's HTTP call restored afterwards */
async function resolveAgainst(plans, trial) {
  const realRequest = PayPal.request;

  PayPal.request = async () => ({ plans: JSON.parse(JSON.stringify(plans)) });

  try {
    return await PayPal.resolvePlanId(PRODUCT, 'monthly', trial);
  } finally {
    PayPal.request = realRequest;
  }
}

module.exports = defineCases({
  description: 'PayPal resolvePlanId(): the twin a checkout lands on',
  type: 'group',

  tests: [
    {
      name: 'a-trial-checkout-takes-the-trial-twin',
      async run({ expect }) {
        expect(await resolveAgainst(BOTH_TWINS, true), 'The plan carrying the free cycle').toBe('P-TRIAL');
      },
    },

    {
      name: 'a-skip-trial-checkout-takes-the-no-trial-twin',
      async run({ expect }) {
        // The trial twin is first in the list and matches interval + amount, so
        // this is exactly the pick the old matcher got wrong
        expect(await resolveAgainst(BOTH_TWINS, false), 'The plan with no free cycle to skip').toBe('P-NO-TRIAL');
      },
    },

    {
      name: 'a-product-without-trial-days-still-resolves-its-one-plan',
      async run({ expect }) {
        expect(await resolveAgainst([plan('P-ONLY', 0)], false), 'One plan, unchanged').toBe('P-ONLY');
      },
    },

    {
      name: 'a-missing-twin-throws-and-names-it',
      async run({ expect }) {
        // A trial product the manager has not re-walked has only the trial twin.
        // Falling back to it would hand a returning buyer a free period they
        // were refused, so the lookup refuses instead and the fix is a manage run.
        let threw = null;

        try {
          await resolveAgainst([plan('P-TRIAL', 7)], false);
        } catch (e) {
          threw = e;
        }

        expect(threw, 'No twin, no plan id').toBeTruthy();
        expect(threw.message, 'The existing plan-lookup refusal').toMatch(/No active PayPal plan/);
        expect(threw.message, 'Naming the twin that is missing').toMatch(/without a trial/);
      },
    },

    {
      name: 'a-trial-twin-of-the-wrong-length-is-not-the-trial-twin',
      async run({ expect }) {
        // The manager matches a trial cycle by presence, so any TRIAL cycle
        // answers a trial checkout — what must never answer it is a plan with
        // none at all
        expect(await resolveAgainst([plan('P-TRIAL-30', 30), plan('P-NO-TRIAL', 0)], true), 'Presence is the match, not the day count').toBe('P-TRIAL-30');
      },
    },
  ],
});
