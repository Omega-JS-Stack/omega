/**
 * Test: PayPal createIntent(), what each checkout is created at
 * ([#758](https://github.com/Omega-JS-Stack/omega/issues/758),
 * [#759](https://github.com/Omega-JS-Stack/omega/issues/759)).
 *
 * A one-time buy asks PayPal for a v2 Order at a price THIS provider computes,
 * and a v2 Order carries no coupon object for PayPal's hosted page to apply, so
 * a code the route validated has to come off here. It did not, so the buyer was
 * charged the list price while the confirmation page (which discounts in
 * routes/payments/intent/post.js) quoted the cheaper number.
 *
 * A subscription has no coupon object either: the plan is a fixed-price plan the
 * manager created, so the discounted first period rides on the subscription
 * create call as a setup fee while the plan's own cycles start a period later,
 * which is what keeps the renewal at the list price.
 *
 * A product with trial days carries TWIN plans per interval — one with the TRIAL
 * cycle, one without — so what a buyer is granted is chosen by WHICH PLAN the
 * checkout subscribes to ([#761](https://github.com/Omega-JS-Stack/omega/issues/761)).
 * A returning buyer skipping the trial lands on the no-trial twin and is
 * discounted like everyone else.
 *
 * The HTTP call is the one thing stubbed: creating a real order needs live
 * PayPal credentials (real provider calls are gated behind extended mode, never
 * mocked). Everything under test runs for real: the amount the order is created
 * at is the whole subject.
 *
 * Run: npx omega test backend:helpers/payment/paypal/create-intent
 */
const intentProvider = require('../../../../dist/manager/routes/payments/intent/providers/paypal.js');
const PayPal = require('../../../../dist/manager/libraries/payment/providers/paypal.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-paypal-buyer';
const ORDER_ID = '_test-order-paypal-1';
const CONFIRMATION_URL = 'https://example.test/payment/confirmation?orderId=_test-order-paypal-1';
const CANCEL_URL = 'https://example.test/payment/checkout?product=launch-kit&payment=cancelled';

const ONE_TIME_PRODUCT = { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } };
const SUBSCRIPTION_PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 20, annually: 200 }, paypal: { productId: 'PROD-TEST' } };

// What PayPal answers a POST /v2/checkout/orders with
const ORDER_RESPONSE = {
  id: '5O190127TN364715T',
  status: 'PAYER_ACTION_REQUIRED',
  links: [
    { rel: 'self', href: 'https://api-m.paypal.com/v2/checkout/orders/5O190127TN364715T' },
    { rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=5O190127TN364715T' },
  ],
};

// The plans the manager's payment walk creates for this product: ONE infinite
// REGULAR cycle each, which is why the discount cannot ride a cycle override
// (re-pricing that cycle would re-price every renewal with it). A product WITH
// trial days also gets a TRIAL twin per interval — the SAME catalog product, so
// both twins sit in this one list and the checkout picks by trial-cycle
// presence.
const PLANS_RESPONSE = {
  plans: [
    {
      id: 'P-TEST-MONTHLY',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '20.00', currency_code: 'USD' } } },
      ],
    },
    {
      id: 'P-TEST-MONTHLY-TRIAL',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'TRIAL', sequence: 1, total_cycles: 7, frequency: { interval_unit: 'DAY', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } },
        { tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '20.00', currency_code: 'USD' } } },
      ],
    },
    {
      id: 'P-TEST-ANNUAL',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, frequency: { interval_unit: 'YEAR', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '200.00', currency_code: 'USD' } } },
      ],
    },
    {
      id: 'P-TEST-ANNUAL-TRIAL',
      status: 'ACTIVE',
      billing_cycles: [
        { tenure_type: 'TRIAL', sequence: 1, total_cycles: 7, frequency: { interval_unit: 'DAY', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } },
        { tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, frequency: { interval_unit: 'YEAR', interval_count: 1 }, pricing_scheme: { fixed_price: { value: '200.00', currency_code: 'USD' } } },
      ],
    },
  ],
};

// A trial product, sharing SUBSCRIPTION_PRODUCT's catalog product (so both
// twins above are its plans)
const TRIAL_PRODUCT = { ...SUBSCRIPTION_PRODUCT, trial: { days: 7 } };

// What PayPal answers a POST /v1/billing/subscriptions with
const SUBSCRIPTION_RESPONSE = {
  id: 'I-BW452GLLEP1G',
  status: 'APPROVAL_PENDING',
  links: [
    { rel: 'self', href: 'https://api-m.paypal.com/v1/billing/subscriptions/I-BW452GLLEP1G' },
    { rel: 'approve', href: 'https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' },
  ],
};

/** A logger the provider can talk to, with no Manager behind it */
function testCtx() {
  const lines = [];

  return { lines, log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
}

/** Run fn with the library's HTTP call replaced by a stand-in, restored afterwards */
async function withPayPalRequest(request, fn) {
  const realRequest = PayPal.request;

  PayPal.request = request;

  try {
    return await fn();
  } finally {
    PayPal.request = realRequest;
  }
}

/** A stand-in that records every call and answers each endpoint with its fixture */
function requestReturning(calls) {
  return async (endpoint, options) => {
    calls.push({ endpoint, options });

    if (endpoint.startsWith('/v1/billing/plans')) {
      return JSON.parse(JSON.stringify(PLANS_RESPONSE));
    }

    if (endpoint.startsWith('/v1/billing/subscriptions')) {
      return JSON.parse(JSON.stringify(SUBSCRIPTION_RESPONSE));
    }

    return JSON.parse(JSON.stringify(ORDER_RESPONSE));
  };
}

function createIntent(options, calls) {
  return withPayPalRequest(requestReturning(calls), () => {
    return intentProvider.createIntent({
      uid: UID,
      orderId: ORDER_ID,
      product: ONE_TIME_PRODUCT,
      productId: ONE_TIME_PRODUCT.id,
      frequency: 'once',
      trial: false,
      discount: null,
      confirmationUrl: CONFIRMATION_URL,
      cancelUrl: CANCEL_URL,
      ctx: testCtx(),
      ...options,
    });
  });
}

/** The amount the order was actually created at */
function amountOf(call) {
  return JSON.parse(call.options.body).purchase_units[0].amount.value;
}

/** Ask for a monthly subscription instead of the one-time buy */
function createSubscriptionIntent(options, calls) {
  return createIntent({
    product: SUBSCRIPTION_PRODUCT,
    productId: SUBSCRIPTION_PRODUCT.id,
    frequency: 'monthly',
    ...options,
  }, calls);
}

/** The body of the POST /v1/billing/subscriptions call */
function subscriptionBody(calls) {
  const call = calls.find(c => c.endpoint === '/v1/billing/subscriptions');

  return call ? JSON.parse(call.options.body) : null;
}

/** A plan list from a product the manager has not re-walked yet: trial twin only */
function trialTwinOnlyRequest(calls) {
  const answer = requestReturning(calls);

  return async (endpoint, options) => {
    const response = await answer(endpoint, options);

    if (endpoint.startsWith('/v1/billing/plans')) {
      return { plans: response.plans.filter(p => p.billing_cycles.some(c => c.tenure_type === 'TRIAL')) };
    }

    return response;
  };
}

/** How many days out a subscription's own billing was told to start */
function daysUntil(startTime) {
  return (new Date(startTime).getTime() - Date.now()) / 86400000;
}

module.exports = defineCases({
  description: 'PayPal createIntent(): what the buyer is charged today',
  type: 'group',

  tests: [
    {
      name: 'charges-the-list-price-with-no-discount',
      async run({ assert }) {
        const calls = [];
        await createIntent({}, calls);

        assert.equal(calls.length, 1, 'Exactly one API call');
        assert.equal(calls[0].endpoint, '/v2/checkout/orders', 'A one-time buy is a v2 Order');
        assert.equal(amountOf(calls[0]), '49.99', 'The full price, undiscounted');
      },
    },

    {
      name: 'a-validated-discount-comes-off-the-order',
      async run({ assert }) {
        // The confirmation URL quotes this same number, so charging the list
        // price here sold a $49.99 order against a $44.99 receipt
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        assert.equal(amountOf(calls[0]), '44.99', '10% off $49.99');
      },
    },

    {
      name: 'a-flat-discount-comes-off-too',
      async run({ assert }) {
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'WELCOME10OFF', percent: 0, amount: 10 } }, calls);

        assert.equal(amountOf(calls[0]), '39.99', '$10 off $49.99');
      },
    },

    {
      name: 'a-subscription-with-no-code-pays-the-plan-price',
      async run({ assert }) {
        const calls = [];
        await createSubscriptionIntent({}, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan_id, 'P-TEST-MONTHLY', 'The plan the manager created for $20.00 monthly');
        assert.equal(body.plan, undefined, 'Nothing overridden: the plan charges its own $20.00 today');
        assert.equal(body.start_time, undefined, 'Nothing to defer: PayPal starts the plan now');
      },
    },

    {
      name: 'a-percent-code-discounts-the-subscriptions-first-period',
      async run({ assert }) {
        // The confirmation URL quotes this same number for a subscription, so a
        // full-price plan charge here sold $20.00 against an $18.00 receipt
        const calls = [];
        await createSubscriptionIntent({ discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan.payment_preferences.setup_fee.value, '18.00', '10% off $20.00, charged at approval');
        assert.equal(body.plan.payment_preferences.setup_fee.currency_code, 'USD', 'The plan currency');
        assert.equal(body.plan.billing_cycles, undefined, 'The plan cycles stand, so every renewal is still $20.00');
        assert.inRange(daysUntil(body.start_time), 27, 32, 'The plan bills a month out, so today is the discounted fee alone');
      },
    },

    {
      name: 'a-flat-code-discounts-the-subscription-too',
      async run({ assert }) {
        const calls = [];
        await createSubscriptionIntent({ discount: { valid: true, code: 'WELCOME10OFF', percent: 0, amount: 10 } }, calls);

        assert.equal(subscriptionBody(calls).plan.payment_preferences.setup_fee.value, '10.00', '$10 off $20.00');
      },
    },

    {
      name: 'an-annual-code-defers-billing-a-year',
      async run({ assert }) {
        const calls = [];
        await createSubscriptionIntent({ frequency: 'annually', discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan_id, 'P-TEST-ANNUAL', 'The annual plan');
        assert.equal(body.plan.payment_preferences.setup_fee.value, '180.00', '10% off $200.00');
        assert.inRange(daysUntil(body.start_time), 360, 370, 'A period out is a YEAR here, not a month');
      },
    },

    {
      name: 'a-free-trial-charges-nothing-today-even-with-a-code',
      async run({ assert }) {
        // The confirmation URL quotes $0 for a trial, and a setup fee would be a
        // real charge on day zero against that quote
        const calls = [];
        await createSubscriptionIntent({ product: TRIAL_PRODUCT, trial: true, discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan_id, 'P-TEST-MONTHLY-TRIAL', 'The TRIAL twin — the free cycle lives on the plan');
        assert.equal(body.plan, undefined, 'No setup fee: the plan trial cycle charges nothing today');
        assert.equal(body.start_time, undefined, 'The trial cycle starts immediately');
      },
    },

    {
      name: 'a-trial-product-bought-without-the-trial-takes-the-no-trial-twin',
      async run({ assert }) {
        // Skipping the trial is a PLAN choice now: the no-trial twin has no free
        // cycle on it, so the buyer is charged the plan's price at approval and
        // reads as paying from day one (#761)
        const calls = [];
        await createSubscriptionIntent({ product: TRIAL_PRODUCT, trial: false }, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan_id, 'P-TEST-MONTHLY', 'The skip-trial twin, not the one carrying the TRIAL cycle');
        assert.equal(body.plan, undefined, 'No override: the plan charges its own $20.00 today');
        assert.equal(body.start_time, undefined, 'No trial cycle to outrun, so nothing is deferred');
      },
    },

    {
      name: 'a-returning-buyers-code-discounts-a-trial-products-first-period',
      async run({ assert }) {
        // The #759 carve-out is gone with the hole it guarded: the winback codes
        // target exactly this buyer, and the confirmation page quotes $16.00
        const calls = [];
        await createSubscriptionIntent({ product: TRIAL_PRODUCT, trial: false, discount: { valid: true, code: 'COMEBACK20', percent: 20, amount: 0 } }, calls);

        const body = subscriptionBody(calls);

        assert.equal(body.plan_id, 'P-TEST-MONTHLY', 'Still the skip-trial twin');
        assert.equal(body.plan.payment_preferences.setup_fee.value, '16.00', '20% off $20.00, charged at approval');
        assert.inRange(daysUntil(body.start_time), 27, 32, 'The plan bills a month out, so today is the discounted fee alone');
      },
    },

    {
      name: 'a-trial-product-with-no-skip-trial-twin-yet-refuses-loudly',
      async run({ assert }) {
        // The manager mints the twin; until that walk runs there is no plan to
        // sell a trial-skipping buyer, and a silent fall back to the trial twin
        // would hand them a free period they were not owed
        const calls = [];
        const product = { ...TRIAL_PRODUCT, paypal: { productId: 'PROD-TRIAL-ONLY' } };

        let threw = null;

        try {
          await withPayPalRequest(trialTwinOnlyRequest(calls), () => intentProvider.createIntent({
            uid: UID,
            orderId: ORDER_ID,
            product,
            productId: product.id,
            frequency: 'monthly',
            trial: false,
            discount: null,
            confirmationUrl: CONFIRMATION_URL,
            cancelUrl: CANCEL_URL,
            ctx: testCtx(),
          }));
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A missing twin refuses the checkout');
        assert.match(threw.message, /No active PayPal plan/, 'The existing plan-lookup refusal');
        assert.match(threw.message, /without a trial/, 'And it names the twin that is missing, so the fix is a manage run');
        assert.equal(subscriptionBody(calls), null, 'Nothing was created');
      },
    },
  ],
});
