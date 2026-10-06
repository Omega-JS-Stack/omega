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
const paypalIntent = require('../../../dist/omega/routes/payments/intent/providers/paypal.js');
const coinbaseIntent = require('../../../dist/omega/routes/payments/intent/providers/coinbase.js');
const PayPal = require('../../../dist/omega/libraries/payment/providers/paypal.js');
const Coinbase = require('../../../dist/omega/libraries/payment/providers/coinbase.js');
const discountCodes = require('../../../dist/omega/libraries/payment/discount-codes.js');
const registry = require('../../../dist/omega/libraries/payment/providers/index.js');
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

/** A logger the provider can talk to, with no omega behind it */
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
      async run({ expect }) {
        // Pinned against the discount-codes SSOT, so a repriced code fails here
        // rather than quietly making every case below prove nothing
        expect(discountCodes.DISCOUNT_CODES[AMOUNT_CODE].amount, `${AMOUNT_CODE} should be $10 off`).toBe(10);
        expect(discountCodes.applyToAmount(CHEAP_ONE_TIME.prices.once, discountCodes.validate(AMOUNT_CODE)), '$10 off $9.99 floors at $0').toBe(0);
        expect(discountCodes.applyToAmount(CHEAP_PLAN.prices.monthly, discountCodes.validate(AMOUNT_CODE)), '$10 off $10.00 is exactly $0').toBe(0);
      },
    },

    {
      name: 'paypal-one-time-refuses-and-creates-no-order',
      async run({ expect }) {
        const { calls, error } = await checkout(paypalIntent, { product: CHEAP_ONE_TIME });

        expect(error, 'A $0.00 v2 Order is refused, not sent').toBeTruthy();
        expect(error.code, 'Coded 400, so the intent route answers the buyer instead of its neutral 500').toBe(400);
        expect(error.message, 'The message names the code the buyer entered').toMatch(/WELCOME10OFF/);
        expect(error.message, 'And the price it covered').toMatch(/\$9\.99/);
        expect(error.message, 'And says why this payment method cannot be used').toMatch(/nothing for PayPal to charge/);
        expect(calls.length, 'PayPal was never called').toBe(0);
      },
    },

    {
      name: 'paypal-subscription-refuses-before-the-plan-lookup',
      async run({ expect }) {
        const { calls, error } = await checkout(paypalIntent, { product: CHEAP_PLAN });

        expect(error, 'A $0.00 setup fee is refused, not sent').toBeTruthy();
        expect(error.code, 'Coded 400 like the one-time refusal').toBe(400);
        expect(error.message, 'The message names the code').toMatch(/WELCOME10OFF/);
        expect(error.message, 'And the period price it covered').toMatch(/\$10\.00/);
        expect(calls.length, 'Not even the plan lookup ran — PayPal is untouched').toBe(0);
      },
    },

    {
      name: 'coinbase-refuses-and-creates-no-charge',
      async run({ expect }) {
        const { calls, error } = await checkout(coinbaseIntent, { product: CHEAP_ONE_TIME });

        expect(error, 'A $0.00 crypto charge is refused, not sent').toBeTruthy();
        expect(error.code, 'Coded 400, the same refusal from the same helper').toBe(400);
        expect(error.message, 'The message names the code').toMatch(/WELCOME10OFF/);
        expect(error.message, 'And the price it covered').toMatch(/\$9\.99/);
        expect(error.message, 'And names the method that cannot take it').toMatch(/nothing for Coinbase Commerce to charge/);
        expect(calls.length, 'Coinbase was never called').toBe(0);
      },
    },

    {
      name: 'a-zero-checkout-on-every-provider-follows-its-descriptor',
      async run({ expect }) {
        // The registry decides, never a provider name: a provider whose row
        // takes a $0 charge is handed one, and every other is refused before
        // its API is called, for each product type it sells
        const code = discountCodes.validate(AMOUNT_CODE);

        for (const descriptor of Object.values(registry.PAYMENT_PROVIDERS)) {
          if (descriptor.acceptsZeroCharge) {
            expect(discountCodes.chargeableAmount(CHEAP_ONE_TIME.prices.once, code, { provider: descriptor.id }), `${descriptor.name} takes the $0 checkout`).toBe(0);
            continue;
          }

          const intent = require(`../../../dist/omega/routes/payments/intent/providers/${descriptor.id}.js`);
          const products = [descriptor.oneTime && CHEAP_ONE_TIME, descriptor.subscriptions && CHEAP_PLAN].filter(Boolean);

          for (const product of products) {
            const { calls, error } = await checkout(intent, { product });

            expect(error?.code, `${descriptor.name} refuses a $0 ${product.type} as a 400, got ${error?.message}`).toBe(400);
            expect(error.message, 'naming the provider').toMatch(new RegExp(`nothing for ${descriptor.name} to charge`));
            expect(calls.length, `${descriptor.name} was never called`).toBe(0);
          }
        }
      },
    },

    {
      name: 'a-code-that-leaves-something-to-charge-still-sells',
      async run({ expect }) {
        // The guard fires on ZERO, never on "discounted": a partial code is the
        // whole point of #758/#759 and must still reach both providers
        const partial = { valid: true, code: 'SAVE10', percent: 10, duration: 'once' };

        const order = await checkout(paypalIntent, { product: CHEAP_ONE_TIME, discount: partial });
        expect(order.error, `A 10% code still buys, got ${order.error?.message}`).toBe(null);
        expect(JSON.parse(order.calls[0].options.body).purchase_units[0].amount.value, '10% off $9.99').toBe('8.99');

        const charge = await checkout(coinbaseIntent, { product: CHEAP_ONE_TIME, discount: partial });
        expect(charge.error, `And still buys in crypto, got ${charge.error?.message}`).toBe(null);
        expect(charge.calls[0].options.body.local_price.amount, 'The same discounted charge').toBe('8.99');

        const subscription = await checkout(paypalIntent, { product: CHEAP_PLAN, discount: partial });
        expect(subscription.error, `And a plan's first period still discounts, got ${subscription.error?.message}`).toBe(null);
        const body = JSON.parse(subscription.calls.find(c => c.endpoint === '/v1/billing/subscriptions').options.body);
        expect(body.plan.payment_preferences.setup_fee.value, '10% off $10.00, charged at approval').toBe('9.00');
      },
    },

    {
      name: 'a-free-trial-charges-nothing-today-and-is-not-this-refusal',
      async run({ expect }) {
        // A trial subscription really does charge $0 today, through the plan's
        // own TRIAL cycle rather than an amount we send — so the guard must not
        // read it as a fully discounted checkout (#759, #761)
        const { calls, error } = await checkout(paypalIntent, { product: TRIAL_PLAN, trial: true });

        expect(error, `A trial checkout is untouched, got ${error?.message}`).toBe(null);

        const body = JSON.parse(calls.find(c => c.endpoint === '/v1/billing/subscriptions').options.body);

        expect(body.plan_id, 'The trial twin, which charges nothing today').toBe('P-TEST-MONTHLY-TRIAL');
        expect(body.plan, 'And no setup fee to refuse').toBe(undefined);
      },
    },

    {
      name: 'a-priceless-product-keeps-its-own-refusal',
      async run({ expect }) {
        // A product configured at no price is a CONFIG hole, not a discounted
        // checkout — every provider already refuses it in its own words, and
        // this guard must not take that sentence over
        const free = { ...CHEAP_ONE_TIME, prices: { once: 0 } };
        const freePlan = { ...CHEAP_PLAN, prices: { monthly: 0 } };

        const order = await checkout(paypalIntent, { product: free, discount: null });
        expect(order.error.message, 'PayPal says what is actually wrong').toMatch(/No one-time price configured/);
        expect(order.error.code, 'And it is a fault, not a buyer-facing 400').toBe(undefined);

        const charge = await checkout(coinbaseIntent, { product: free, discount: null });
        expect(charge.error.message, 'Coinbase says the same').toMatch(/No one-time price configured/);

        const subscription = await checkout(paypalIntent, { product: freePlan, discount: null });
        expect(subscription.error.message, 'And the plan lookup keeps its own words').toMatch(/No price configured/);
      },
    },
  ],
});
