/**
 * Test: the PayPal refund provider derives its billing period, never guesses it
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A prorated refund is `days remaining / days in period × amount`. PayPal
 * exposes no period on a transaction, and when a subscription is cancelled or
 * suspended it drops `next_billing_time` too — exactly the state a refund is
 * requested in. The old code answered that with a flat 50% of the payment, which
 * is not a computation, it is an invented number attached to somebody's money.
 * The period is now rebuilt from the payment being refunded plus the plan's own
 * REGULAR billing interval, and when even that is unavailable the refund refuses.
 *
 * PayPal's HTTP client is the one thing stood in for here: it is the external
 * boundary (a live subscription and plan), and every assertion is about the
 * arithmetic on this side of it.
 *
 * Run: npx omega test backend:routes/payments/refund-paypal-proration
 */
const paypalRefund = require('../../../src/manager/routes/payments/refund/providers/paypal.js');

// A stand-in for the PayPal HTTP client — the external boundary. It answers plan
// lookups from the fixture it was built with and records what was asked for.
function paypalClient(plan) {
  const requested = [];

  return {
    requested,
    async request(path) {
      requested.push(path);

      if (plan) {
        return plan;
      }

      throw new Error('PayPal API 404: The specified resource does not exist.');
    },
  };
}

const monthlyPlan = { billing_cycles: [{ tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: 7 } }, { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } }] };
const annualPlan = { billing_cycles: [{ tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } }] };
const weeklyPlan = { billing_cycles: [{ tenure_type: 'REGULAR', frequency: { interval_unit: 'WEEK', interval_count: 2 } }] };

const PERIOD_START = new Date('2026-03-01T00:00:00.000Z');

function resolve({ sub, plan, periodStart, ctx }) {
  const PayPalLib = paypalClient(plan);

  return paypalRefund.resolvePeriodEnd({
    sub,
    resourceId: 'I-TEST-PRORATION',
    periodStart: periodStart || PERIOD_START,
    PayPalLib,
    ctx,
  });
}

async function rejects(assert, promise, pattern, message) {
  try {
    await promise;
  } catch (e) {
    assert.match(e.message, pattern, `${message} — got: ${e.message}`);
    return;
  }

  assert.ok(false, `${message} — it resolved instead of refusing`);
}

module.exports = {
  description: 'PayPal refund proration: the billing period is derived or refused',
  type: 'group',

  tests: [
    {
      name: 'uses-paypals-own-next-billing-time',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-TEST', billing_info: { next_billing_time: '2026-04-01T00:00:00.000Z' } };

        const periodEnd = await resolve({ sub, plan: monthlyPlan, ctx });

        assert.equal(periodEnd.toISOString(), '2026-04-01T00:00:00.000Z', "PayPal's own period end wins when it is present");
      },
    },

    {
      name: 'derives-a-monthly-period-from-the-plan',
      async run({ assert, ctx }) {
        // A cancelled subscription: no next_billing_time, which is the state a refund arrives in
        const sub = { plan_id: 'P-TEST', status: 'CANCELLED', billing_info: {} };

        const periodEnd = await resolve({ sub, plan: monthlyPlan, ctx });

        assert.equal(periodEnd.toISOString(), '2026-04-01T00:00:00.000Z', 'One MONTH after the payment being refunded');
      },
    },

    {
      name: 'derives-an-annual-period-from-the-plan',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-TEST', billing_info: {} };

        const periodEnd = await resolve({ sub, plan: annualPlan, ctx });

        assert.equal(periodEnd.toISOString(), '2027-03-01T00:00:00.000Z', 'One YEAR after the payment being refunded');
      },
    },

    {
      name: 'honors-the-plans-interval-count',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-TEST', billing_info: {} };

        const periodEnd = await resolve({ sub, plan: weeklyPlan, ctx });

        assert.equal(periodEnd.toISOString(), '2026-03-15T00:00:00.000Z', 'Two WEEKs after the payment being refunded');
      },
    },

    {
      name: 'ignores-the-trial-cycle',
      async run({ assert, ctx }) {
        // monthlyPlan leads with a 7-day TRIAL cycle: the REGULAR one is the billing period
        const sub = { plan_id: 'P-TEST', billing_info: {} };

        const periodEnd = await resolve({ sub, plan: monthlyPlan, ctx });

        assert.equal(periodEnd.toISOString(), '2026-04-01T00:00:00.000Z', 'The REGULAR cycle is the billing interval, not the trial');
      },
    },

    {
      name: 'refuses-when-the-subscription-has-no-plan',
      async run({ assert, ctx }) {
        const sub = { billing_info: {} };

        await rejects(
          assert,
          resolve({ sub, plan: monthlyPlan, ctx }),
          /billing period cannot be derived/i,
          'No next_billing_time and no plan_id must refuse',
        );
      },
    },

    {
      name: 'refuses-when-the-plan-has-no-regular-cycle',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-TEST', billing_info: {} };
        const trialOnlyPlan = { billing_cycles: [{ tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: 7 } }] };

        await rejects(
          assert,
          resolve({ sub, plan: trialOnlyPlan, ctx }),
          /billing period cannot be derived/i,
          'A plan with no REGULAR cycle must refuse',
        );
      },
    },

    {
      name: 'refuses-when-the-plan-lookup-fails',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-GONE', billing_info: {} };

        await rejects(
          assert,
          resolve({ sub, plan: null, ctx }),
          /PayPal API 404/,
          'A failed plan lookup must surface, not fall back to a guess',
        );
      },
    },

    {
      name: 'refuses-an-unknown-interval-unit',
      async run({ assert, ctx }) {
        const sub = { plan_id: 'P-TEST', billing_info: {} };
        const oddPlan = { billing_cycles: [{ tenure_type: 'REGULAR', frequency: { interval_unit: 'FORTNIGHT', interval_count: 1 } }] };

        await rejects(
          assert,
          resolve({ sub, plan: oddPlan, ctx }),
          /billing period cannot be derived/i,
          'An interval unit we cannot convert must refuse',
        );
      },
    },
  ],
};
