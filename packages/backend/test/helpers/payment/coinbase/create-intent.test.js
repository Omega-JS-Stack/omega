/**
 * Test: Coinbase Commerce createIntent()
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * The intent provider asks Coinbase for a hosted CHARGE and hands the checkout
 * its `hosted_url` to redirect to. The HTTP call is the one thing stubbed here —
 * a real charge needs live Coinbase Commerce credentials (real provider calls
 * are gated behind extended mode, never mocked). Everything under test runs for
 * real: the one-time guard, the price the charge is created at, and the metadata
 * the webhook pipeline later reads its identifiers back out of.
 *
 * Run: npx omega test backend:helpers/payment/coinbase/create-intent
 */
const intentProvider = require('../../../../dist/manager/routes/payments/intent/providers/coinbase.js');
const Coinbase = require('../../../../dist/manager/libraries/payment/providers/coinbase.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-coinbase-buyer';
const ORDER_ID = '_test-order-coinbase-1';
const CONFIRMATION_URL = 'https://example.test/payment/confirmation?orderId=_test-order-coinbase-1';
const CANCEL_URL = 'https://example.test/payment/checkout?product=launch-kit&payment=cancelled';

const ONE_TIME_PRODUCT = { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } };
const SUBSCRIPTION_PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } };

// What Coinbase answers a POST /charges with
const CHARGE_RESPONSE = {
  data: {
    id: '8f783fa6-eaa3-4460-af64-cac26b183ed1',
    code: 'FBHJR22R',
    resource: 'charge',
    hosted_url: 'https://commerce.coinbase.com/charges/FBHJR22R',
    pricing: { local: { amount: '49.99', currency: 'USD' } },
    timeline: [{ status: 'NEW' }],
  },
};

/** A logger the provider can talk to, with no Manager behind it */
function testCtx() {
  const lines = [];

  return { lines, log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
}

/** Run fn with the library's HTTP call replaced by a stand-in, restored afterwards */
async function withCoinbaseRequest(request, fn) {
  const realRequest = Coinbase.request;

  Coinbase.request = request;

  try {
    return await fn();
  } finally {
    Coinbase.request = realRequest;
  }
}

/** A stand-in that records every call and answers with `response` */
function requestReturning(response, calls) {
  return async (endpoint, options) => {
    calls.push({ endpoint, options });

    return JSON.parse(JSON.stringify(response));
  };
}

function createIntent(options, calls, response = CHARGE_RESPONSE) {
  return withCoinbaseRequest(requestReturning(response, calls), () => {
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

module.exports = defineCases({
  description: 'Coinbase Commerce createIntent()',
  type: 'group',

  tests: [
    {
      name: 'creates-a-hosted-charge',
      async run({ assert }) {
        const calls = [];
        const result = await createIntent({}, calls);

        assert.equal(calls.length, 1, 'Exactly one API call');
        assert.equal(calls[0].endpoint, '/charges', 'A charge is created at POST /charges');
        assert.equal(calls[0].options.method, 'POST');
      },
    },

    {
      name: 'the-redirect-is-the-hosted-url',
      async run({ assert }) {
        const result = await createIntent({}, []);

        assert.equal(result.url, 'https://commerce.coinbase.com/charges/FBHJR22R', 'The buyer is sent to the hosted charge');
        assert.equal(result.id, '8f783fa6-eaa3-4460-af64-cac26b183ed1', 'The intent id is the charge id the webhook will name');
        assert.equal(result.raw.code, 'FBHJR22R', 'The raw charge rides along onto the intent doc');
      },
    },

    {
      name: 'charges-a-fixed-price-in-usd',
      async run({ assert }) {
        const calls = [];
        await createIntent({}, calls);

        const body = calls[0].options.body;

        assert.equal(body.pricing_type, 'fixed_price', 'The buyer pays the price we set, never a donation amount');
        assert.deepEqual(body.local_price, { amount: '49.99', currency: 'USD' });
      },
    },

    {
      name: 'a-validated-discount-comes-off-the-charge',
      async run({ assert }) {
        // The charge is a FIXED price this file computes — Coinbase has no
        // coupon object — so a code the route validated has to be applied here
        // or the buyer pays full price in crypto while the confirmation page
        // reports the discounted amount
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        assert.equal(calls[0].options.body.local_price.amount, '44.99', '10% off $49.99');
      },
    },

    {
      name: 'a-flat-discount-comes-off-too',
      async run({ assert }) {
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'TENOFF', percent: 0, amount: 10 } }, calls);

        assert.equal(calls[0].options.body.local_price.amount, '39.99', '$10 off $49.99');
      },
    },

    {
      name: 'carries-the-identifiers-the-pipeline-reads-back',
      async run({ assert }) {
        const calls = [];
        await createIntent({}, calls);

        const metadata = calls[0].options.body.metadata;

        assert.deepEqual(metadata, { uid: UID, orderId: ORDER_ID, productId: 'launch-kit' });
        assert.equal(Coinbase.getUid({ metadata }), UID, 'And the library reads its own metadata back');
        assert.equal(Coinbase.getOrderId({ metadata }), ORDER_ID);
      },
    },

    {
      name: 'carries-both-redirects',
      async run({ assert }) {
        const calls = [];
        await createIntent({}, calls);

        assert.equal(calls[0].options.body.redirect_url, CONFIRMATION_URL);
        assert.equal(calls[0].options.body.cancel_url, CANCEL_URL);
      },
    },

    {
      name: 'refuses-a-subscription-product',
      async run({ assert }) {
        // Coinbase Commerce has no recurring anything. Selling one as a single
        // charge would take the money and grant a plan nothing renews.
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: SUBSCRIPTION_PRODUCT, productId: 'premium', frequency: 'monthly' }, calls);
        } catch (e) {
          threw = true;
          assert.match(e.message, /one-time payment/i, 'The refusal says why');
        }

        assert.ok(threw, 'A subscription must be refused');
        assert.equal(calls.length, 0, 'And refused BEFORE Coinbase is called');
      },
    },

    {
      name: 'refuses-an-archived-product',
      async run({ assert }) {
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: { ...ONE_TIME_PRODUCT, archived: true } }, calls);
        } catch (e) {
          threw = true;
          assert.match(e.message, /archived/i);
        }

        assert.ok(threw, 'An archived product must be refused');
        assert.equal(calls.length, 0, 'And refused before Coinbase is called');
      },
    },

    {
      name: 'refuses-a-product-with-no-one-time-price',
      async run({ assert }) {
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: {} } }, calls);
        } catch (e) {
          threw = true;
          assert.match(e.message, /no one-time price/i);
        }

        assert.ok(threw, 'A priceless product must be refused');
        assert.equal(calls.length, 0);
      },
    },

    {
      name: 'refuses-a-charge-that-came-back-without-a-page-to-pay-it-on',
      async run({ assert }) {
        let threw = false;

        try {
          await createIntent({}, [], { data: { id: 'ch_no_url', code: 'NOURL123' } });
        } catch (e) {
          threw = true;
          assert.match(e.message, /no hosted_url/i, 'A charge with nowhere to pay it is not an intent');
        }

        assert.ok(threw, 'A urlless charge must throw rather than redirect to undefined');
      },
    },
  ],
});
