/**
 * Test: a code that covers the WHOLE price never reaches PayPal or Coinbase
 * ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)).
 *
 * Stripe and Chargebee hand their hosted page a real coupon object and let the
 * provider decide what a zero total means. PayPal and Coinbase are prices this
 * framework computes and SENDS, and `applyToAmount()` floors at zero — so the
 * shipped catalog's `WELCOME10OFF` on any product priced at or under $10 asked
 * PayPal for a $0.00 order (or setup fee) and Coinbase for a $0.00 charge.
 * Neither API accepts one, so the buyer got the checkout's generic failure
 * sentence for a code the page had just told them was applied.
 *
 * `chargeableAmount()` (libraries/payment/discount-codes.js) is the ONE place
 * that refuses it, called by both providers, and its Error is coded 400 so
 * `POST /payments/intent` answers the buyer with those words — naming the code
 * and the price — instead of its neutral 500 line. That wire response is an
 * emulator case (the route reads Firestore before it dispatches); what this
 * suite proves is the refusal itself, its message, its 400, and that no
 * provider call was ever made.
 *
 * The HTTP call is the one thing stubbed: creating a real order needs live
 * credentials. Everything under test runs for real.
 *
 * Run: npx omega test backend:routes/payments/intent-zero-total
 */
const paypalIntent = require('../../../dist/manager/routes/payments/intent/providers/paypal.js');
const coinbaseIntent = require('../../../dist/manager/routes/payments/intent/providers/coinbase.js');
const PayPal = require('../../../dist/manager/libraries/payment/providers/paypal.js');
const Coinbase = require('../../../dist/manager/libraries/payment/providers/coinbase.js');
const discountCodes = require('../../../dist/manager/libraries/payment/discount-codes.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-zero-total-buyer';
const ORDER_ID = '_test-order-zero-total';
const CONFIRMATION_URL = 'https://example.test/payment/confirmation?orderId=_test-order-zero-total';
const CANCEL_URL = 'https://example.test/payment/checkout?product=pocket-guide&payment=cancelled';

// The shipped flat-dollar code, and the two prices it can swallow whole: a
// cheap one-time buy and a cheap monthly plan. $9.99 is the interesting one —
// the code is worth MORE than the charge, so applyToAmount() floors it at zero.
const AMOUNT_CODE = 'WELCOME10OFF';
const CHEAP_ONE_TIME = { id: 'pocket-guide', name: 'Pocket Guide', type: 'one-time', prices: { once: 9.99 } };
const CHEAP_PLAN = { id: 'pocket-plan', name: 'Pocket Plan', type: 'subscription', prices: { monthly: 10 }, paypal: { productId: 'PROD-TEST' } };
const TRIAL_PLAN = { ...CHEAP_PLAN, trial: { days: 7 } };

// What PayPal answers each endpoint with, if it is ever reached at all
const PLANS_RESPONSE = {
  plans: [
    {
      id: 'P-TEST-MONTHLY',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '10.00', currency_code: 'USD' } } },
      ],
    },
    {
      id: 'P-TEST-MONTHLY-TRIAL',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'TRIAL', sequence: 1, total_cycles: 7, frequency: { interval_unit: 'DAY', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } },
        { tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '10.00', currency_code: 'USD' } } },
      ],
    },
  ],
};
const ORDER_RESPONSE = {
  id: '5O190127TN364715T',
  status: 'PAYER_ACTION_REQUIRED',
  links: [{ rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=5O190127TN364715T' }],
};
const SUBSCRIPTION_RESPONSE = {
  id: 'I-BW452GLLEP1G',
  status: 'APPROVAL_PENDING',
  links: [{ rel: 'approve', href: 'https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' }],
};
const CHARGE_RESPONSE = {
  data: {
    id: '8f783fa6-eaa3-4460-af64-cac26b183ed1',
    code: 'ABCD1234',
    hosted_url: 'https://commerce.coinbase.com/charges/ABCD1234',
  },
};

/** A logger the provider can talk to, with no Manager behind it */
function testCtx() {
  const lines = [];

  return { lines, log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
}

/** Run fn with both libraries' HTTP call replaced by a recorder, restored afterwards */
async function withProviderCalls(fn) {
  const calls = [];
  const realPayPal = PayPal.request;
  const realCoinbase = Coinbase.request;

  PayPal.request = async (endpoint, options) => {
    calls.push({ provider: 'paypal', endpoint, options });

    if (endpoint.startsWith('/v1/billing/plans')) {
      return JSON.parse(JSON.stringify(PLANS_RESPONSE));
    }

    if (endpoint.startsWith('/v1/billing/subscriptions')) {
      return JSON.parse(JSON.stringify(SUBSCRIPTION_RESPONSE));
    }

    return JSON.parse(JSON.stringify(ORDER_RESPONSE));
  };

  Coinbase.request = async (endpoint, options) => {
    calls.push({ provider: 'coinbase', endpoint, options });

    return JSON.parse(JSON.stringify(CHARGE_RESPONSE));
  };

  try {
    return { calls, result: await fn(calls), error: null };
  } catch (e) {
    return { calls, result: null, error: e };
  } finally {
    PayPal.request = realPayPal;
    Coinbase.request = realCoinbase;
  }
}

/** One checkout attempt against a provider module, with the HTTP calls recorded */
function checkout(provider, { product, frequency, trial, discount }) {
  return withProviderCalls(() => provider.createIntent({
    uid: UID,
    orderId: ORDER_ID,
    product,
    productId: product.id,
    frequency: frequency || (product.type === 'one-time' ? 'once' : 'monthly'),
    trial: !!trial,
    discount: discount === undefined ? discountCodes.validate(AMOUNT_CODE) : discount,
    confirmationUrl: CONFIRMATION_URL,
    cancelUrl: CANCEL_URL,
    ctx: testCtx(),
  }));
}

module.exports = defineCases({
  description: 'A fully discounted checkout is refused before PayPal or Coinbase is called',
  type: 'group',

  tests: [
    {
      name: 'the-code-really-does-cover-these-prices',
      async run({ assert }) {
        // Pinned against the discount-codes SSOT, so a repriced code fails here
        // rather than quietly making every case below prove nothing
        assert.equal(discountCodes.DISCOUNT_CODES[AMOUNT_CODE].amount, 10, `${AMOUNT_CODE} should be $10 off`);
        assert.equal(discountCodes.applyToAmount(CHEAP_ONE_TIME.prices.once, discountCodes.validate(AMOUNT_CODE)), 0, '$10 off $9.99 floors at $0');
        assert.equal(discountCodes.applyToAmount(CHEAP_PLAN.prices.monthly, discountCodes.validate(AMOUNT_CODE)), 0, '$10 off $10.00 is exactly $0');
      },
    },

    {
      name: 'paypal-one-time-refuses-and-creates-no-order',
      async run({ assert }) {
        const { calls, error } = await checkout(paypalIntent, { product: CHEAP_ONE_TIME });

        assert.ok(error, 'A $0.00 v2 Order is refused, not sent');
        assert.equal(error.code, 400, 'Coded 400, so the intent route answers the buyer instead of its neutral 500');
        assert.match(error.message, /WELCOME10OFF/, 'The message names the code the buyer entered');
        assert.match(error.message, /\$9\.99/, 'And the price it covered');
        assert.match(error.message, /nothing for PayPal to charge/, 'And says why this payment method cannot be used');
        assert.equal(calls.length, 0, 'PayPal was never called');
      },
    },

    {
      name: 'paypal-subscription-refuses-before-the-plan-lookup',
      async run({ assert }) {
        const { calls, error } = await checkout(paypalIntent, { product: CHEAP_PLAN });

        assert.ok(error, 'A $0.00 setup fee is refused, not sent');
        assert.equal(error.code, 400, 'Coded 400 like the one-time refusal');
        assert.match(error.message, /WELCOME10OFF/, 'The message names the code');
        assert.match(error.message, /\$10\.00/, 'And the period price it covered');
        assert.equal(calls.length, 0, 'Not even the plan lookup ran — PayPal is untouched');
      },
    },

    {
      name: 'coinbase-refuses-and-creates-no-charge',
      async run({ assert }) {
        const { calls, error } = await checkout(coinbaseIntent, { product: CHEAP_ONE_TIME });

        assert.ok(error, 'A $0.00 crypto charge is refused, not sent');
        assert.equal(error.code, 400, 'Coded 400, the same refusal from the same helper');
        assert.match(error.message, /WELCOME10OFF/, 'The message names the code');
        assert.match(error.message, /\$9\.99/, 'And the price it covered');
        assert.match(error.message, /nothing for Coinbase Commerce to charge/, 'And names the method that cannot take it');
        assert.equal(calls.length, 0, 'Coinbase was never called');
      },
    },

    {
      name: 'a-code-that-leaves-something-to-charge-still-sells',
      async run({ assert }) {
        // The guard fires on ZERO, never on "discounted": a partial code is the
        // whole point of #758/#759 and must still reach both providers
        const partial = { valid: true, code: 'SAVE10', percent: 10, duration: 'once' };

        const order = await checkout(paypalIntent, { product: CHEAP_ONE_TIME, discount: partial });
        assert.equal(order.error, null, `A 10% code still buys, got ${order.error?.message}`);
        assert.equal(JSON.parse(order.calls[0].options.body).purchase_units[0].amount.value, '8.99', '10% off $9.99');

        const charge = await checkout(coinbaseIntent, { product: CHEAP_ONE_TIME, discount: partial });
        assert.equal(charge.error, null, `And still buys in crypto, got ${charge.error?.message}`);
        assert.equal(charge.calls[0].options.body.local_price.amount, '8.99', 'The same discounted charge');

        const subscription = await checkout(paypalIntent, { product: CHEAP_PLAN, discount: partial });
        assert.equal(subscription.error, null, `And a plan's first period still discounts, got ${subscription.error?.message}`);
        const body = JSON.parse(subscription.calls.find(c => c.endpoint === '/v1/billing/subscriptions').options.body);
        assert.equal(body.plan.payment_preferences.setup_fee.value, '9.00', '10% off $10.00, charged at approval');
      },
    },

    {
      name: 'a-free-trial-charges-nothing-today-and-is-not-this-refusal',
      async run({ assert }) {
        // A trial subscription really does charge $0 today, through the plan's
        // own TRIAL cycle rather than an amount we send — so the guard must not
        // read it as a fully discounted checkout (#759, #761)
        const { calls, error } = await checkout(paypalIntent, { product: TRIAL_PLAN, trial: true });

        assert.equal(error, null, `A trial checkout is untouched, got ${error?.message}`);

        const body = JSON.parse(calls.find(c => c.endpoint === '/v1/billing/subscriptions').options.body);

        assert.equal(body.plan_id, 'P-TEST-MONTHLY-TRIAL', 'The trial twin, which charges nothing today');
        assert.equal(body.plan, undefined, 'And no setup fee to refuse');
      },
    },

    {
      name: 'a-priceless-product-keeps-its-own-refusal',
      async run({ assert }) {
        // A product configured at no price is a CONFIG hole, not a discounted
        // checkout — every provider already refuses it in its own words, and
        // this guard must not take that sentence over
        const free = { ...CHEAP_ONE_TIME, prices: { once: 0 } };
        const freePlan = { ...CHEAP_PLAN, prices: { monthly: 0 } };

        const order = await checkout(paypalIntent, { product: free, discount: null });
        assert.match(order.error.message, /No one-time price configured/, 'PayPal says what is actually wrong');
        assert.equal(order.error.code, undefined, 'And it is a fault, not a buyer-facing 400');

        const charge = await checkout(coinbaseIntent, { product: free, discount: null });
        assert.match(charge.error.message, /No one-time price configured/, 'Coinbase says the same');

        const subscription = await checkout(paypalIntent, { product: freePlan, discount: null });
        assert.match(subscription.error.message, /No price configured/, 'And the plan lookup keeps its own words');
      },
    },
  ],
});
