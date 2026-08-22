/**
 * Test: what the REAL providers ask their provider to create for a discount code
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * Stripe coupons come in two shapes — `percent_off` and `amount_off` — and the
 * seeded code table now carries both. Until it did, every coupon builder was
 * percent-only, so an amount-based code would have built `percent_off: undefined`
 * and the provider would have rejected the coupon, failing the checkout at its
 * first step.
 *
 * The provider SDK/HTTP seam is the ONE thing stubbed — creating a coupon needs a
 * live Stripe/Chargebee account. The discount validation, the id derivation and
 * the coupon params themselves are the real code paths, reached through each
 * provider's real `createIntent()`. Same technique as
 * intent-one-time-metadata.test.js.
 *
 * Run: npx omega test framework:routes/payments/intent-discount-coupons
 */
const StripeLib = require('../../../src/manager/libraries/payment/providers/stripe.js');
const ChargebeeLib = require('../../../src/manager/libraries/payment/providers/chargebee.js');
const stripeIntent = require('../../../src/manager/routes/payments/intent/providers/stripe.js');
const chargebeeIntent = require('../../../src/manager/routes/payments/intent/providers/chargebee.js');
const discountCodes = require('../../../src/manager/libraries/payment/discount-codes.js');

const UID = '_test-intent-coupon-uid';
const ORDER_ID = '2424-6868-1212';

const PERCENT_CODE = 'WELCOME15';
const AMOUNT_CODE = 'WELCOME10OFF';

// A subscription product carrying BOTH providers' ids — the fixture is data, not
// a stand-in: every branch it drives is real code
const PRODUCT = {
  id: 'premium',
  name: 'Premium',
  type: 'subscription',
  prices: { monthly: 49.99 },
  stripe: { productId: 'prod_test_premium' },
  chargebee: { itemId: 'premium-item' },
};

/**
 * The ctx a provider receives. `Manager` is the runner's REAL one — the coupon
 * builders read the brand's currency off its resolved config.
 */
function buildCtx(Manager) {
  return {
    Manager,
    log: () => {},
    getUser: () => ({ auth: { email: `${UID}@example.com` } }),
  };
}

function expectedCurrency(config) {
  return config.payment?.currency || 'USD';
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

/** Run fn with the library's SDK replaced by a stand-in, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = StripeLib.init;

  StripeLib.init = () => sdk;

  try {
    return await fn();
  } finally {
    StripeLib.init = realInit;
  }
}

/**
 * A stand-in SDK that answers the lookups and records the coupon it was asked
 * for. `couponExists` decides whether retrieve() finds one — a miss throws the
 * `resource_missing` error the real SDK throws, which is what the builder reads.
 */
function sdkCapturing(captured, { couponExists = false } = {}) {
  return {
    prices: {
      list: () => [{ id: 'price_test_monthly', unit_amount: 4999, recurring: { interval: 'month' }, product: 'prod_test_premium' }],
    },
    customers: {
      search: async () => ({ data: [{ id: 'cus_test_intent_coupon' }] }),
    },
    coupons: {
      retrieve: async (id) => {
        captured.retrieved = id;

        if (couponExists) {
          return { id };
        }

        const error = new Error(`No such coupon: ${id}`);
        error.code = 'resource_missing';
        throw error;
      },
      create: async (params, options) => {
        captured.created = params;
        captured.createOptions = options;
        return params;
      },
    },
    checkout: {
      sessions: {
        create: async (params) => {
          captured.session = params;
          return { id: 'cs_test_intent_coupon', url: 'https://checkout.example/cs_test_intent_coupon' };
        },
      },
    },
  };
}

async function stripeCheckout(Manager, code, options) {
  const captured = {};

  await withStripeSdk(sdkCapturing(captured, options), () => stripeIntent.createIntent({
    uid: UID,
    orderId: ORDER_ID,
    product: PRODUCT,
    productId: PRODUCT.id,
    frequency: 'monthly',
    trial: false,
    discount: discountCodes.validate(code),
    confirmationUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    ctx: buildCtx(Manager),
  }));

  return captured;
}

// ─── Chargebee ───────────────────────────────────────────────────────────────

/** Run fn with the library's HTTP door replaced by a recorder, restored afterwards */
async function withChargebeeApi(handler, fn) {
  const realInit = ChargebeeLib.init;
  const realRequest = ChargebeeLib.request;

  ChargebeeLib.init = () => ({});
  ChargebeeLib.request = handler;

  try {
    return await fn();
  } finally {
    ChargebeeLib.init = realInit;
    ChargebeeLib.request = realRequest;
  }
}

async function chargebeeCheckout(Manager, code, { couponExists = false } = {}) {
  const captured = {};

  const handler = async (endpoint, options) => {
    if (endpoint.startsWith('/coupons/')) {
      captured.retrieved = endpoint.replace('/coupons/', '');

      if (couponExists) {
        return { coupon: { id: captured.retrieved } };
      }

      const error = new Error(`Coupon not found: ${endpoint}`);
      error.status = 404;
      throw error;
    }

    if (endpoint === '/coupons') {
      captured.created = options.body;
      return { coupon: options.body };
    }

    captured.checkout = options.body;
    return { hosted_page: { id: 'hp_test_intent_coupon', url: 'https://chargebee.example/hp' } };
  };

  await withChargebeeApi(handler, () => chargebeeIntent.createIntent({
    uid: UID,
    orderId: ORDER_ID,
    product: PRODUCT,
    productId: PRODUCT.id,
    frequency: 'monthly',
    trial: false,
    discount: discountCodes.validate(code),
    confirmationUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    ctx: buildCtx(Manager),
  }));

  return captured;
}

module.exports = {
  description: 'Payment intent: real-provider coupons for both discount shapes',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'stripe-an-amount-code-creates-an-amount_off-coupon-in-cents',
      auth: 'none',
      async run({ assert, Manager, config }) {
        const captured = await stripeCheckout(Manager, AMOUNT_CODE);
        const created = captured.created;

        assert.ok(created, 'The provider should have created a coupon');
        assert.equal(created.amount_off, 1000, 'Stripe takes amount_off in CENTS — $10 is 1000');
        assert.equal(created.currency, expectedCurrency(config).toLowerCase(), 'Stripe requires a currency alongside amount_off');
        assert.equal('percent_off' in created, false, 'An amount coupon must not carry percent_off at all');
        assert.equal(created.duration, 'once', 'Every code is first-charge only');
        assert.equal(created.id, captured.retrieved, 'The id it created is the id it looked for');
        assert.match(created.id, /WELCOME10OFF/, 'The id names the code');
        assert.equal(captured.session.discounts[0].coupon, created.id, 'The checkout session applies the coupon it just made');
      },
    },

    {
      name: 'stripe-a-percent-code-is-unchanged',
      auth: 'none',
      async run({ assert, Manager }) {
        const captured = await stripeCheckout(Manager, PERCENT_CODE);
        const created = captured.created;

        // The id is byte-identical to what it has always been — coupons already
        // live in a brand's Stripe account keep resolving instead of being
        // duplicated under a new id
        assert.equal(captured.retrieved, `BEM_${PERCENT_CODE}_15OFF_ONCE`, 'The percent coupon id is unchanged');
        assert.equal(created.percent_off, 15, 'A percent coupon still carries percent_off');
        assert.equal('amount_off' in created, false, 'A percent coupon carries no amount_off');
        assert.equal('currency' in created, false, 'A percent coupon needs no currency');
        assert.equal(created.name, `${PERCENT_CODE} (15% off first payment)`, 'The dashboard label is unchanged');
      },
    },

    {
      name: 'stripe-the-two-shapes-never-share-a-coupon-id',
      auth: 'none',
      async run({ assert, Manager }) {
        const amount = await stripeCheckout(Manager, AMOUNT_CODE);
        const percent = await stripeCheckout(Manager, PERCENT_CODE);

        assert.notEqual(amount.retrieved, percent.retrieved, 'A $10-off coupon and a 15%-off coupon are different coupons');
      },
    },

    {
      name: 'stripe-an-existing-amount-coupon-is-reused-not-recreated',
      auth: 'none',
      async run({ assert, Manager }) {
        const captured = await stripeCheckout(Manager, AMOUNT_CODE, { couponExists: true });

        assert.ok(captured.retrieved, 'It should have looked the coupon up');
        assert.equal(captured.created, undefined, 'An existing coupon is reused, never re-created');
        assert.equal(captured.session.discounts[0].coupon, captured.retrieved, 'The session applies the coupon it found');
      },
    },

    {
      name: 'chargebee-an-amount-code-creates-a-fixed_amount-coupon',
      auth: 'none',
      async run({ assert, Manager, config }) {
        const captured = await chargebeeCheckout(Manager, AMOUNT_CODE);
        const created = captured.created;

        assert.ok(created, 'The provider should have created a coupon');
        assert.equal(created.discount_type, 'fixed_amount', 'A flat-dollar code is a fixed_amount coupon');
        assert.equal(created.discount_amount, 1000, 'Chargebee takes the amount in the currency\'s minor unit — $10 is 1000');
        assert.equal(created.currency_code, expectedCurrency(config).toUpperCase(), 'A fixed_amount coupon names its currency');
        assert.equal('discount_percentage' in created, false, 'An amount coupon must not carry a percentage');
        assert.equal(created.duration_type, 'one_time', 'Every code is first-charge only');
        assert.equal(created.id, captured.retrieved, 'The id it created is the id it looked for');
        assert.equal(captured.checkout.coupon_ids[0], created.id, 'The hosted page applies the coupon it just made');
      },
    },

    {
      name: 'chargebee-a-percent-code-is-unchanged',
      auth: 'none',
      async run({ assert, Manager }) {
        const captured = await chargebeeCheckout(Manager, PERCENT_CODE);
        const created = captured.created;

        assert.equal(captured.retrieved, `BEM_${PERCENT_CODE}_15OFF_ONCE`, 'The percent coupon id is unchanged');
        assert.equal(created.discount_type, 'percentage', 'A percent code is still a percentage coupon');
        assert.equal(created.discount_percentage, 15, 'It still carries its percentage');
        assert.equal('discount_amount' in created, false, 'A percent coupon carries no amount');
        assert.equal('currency_code' in created, false, 'A percent coupon needs no currency');
        assert.equal(created.apply_on, 'invoice_amount', 'Unchanged: the coupon applies to the invoice amount');
      },
    },
  ],
};
