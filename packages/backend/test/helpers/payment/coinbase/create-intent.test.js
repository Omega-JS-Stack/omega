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
const intentProvider = require('../../../../dist/omega/routes/payments/intent/providers/coinbase.js');
const Coinbase = require('../../../../dist/omega/libraries/payment/providers/coinbase.js');
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

/** A logger the provider can talk to, with no omega behind it */
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
      async run({ expect }) {
        const calls = [];
        const result = await createIntent({}, calls);

        expect(calls.length, 'Exactly one API call').toBe(1);
        expect(calls[0].endpoint, 'A charge is created at POST /charges').toBe('/charges');
        expect(calls[0].options.method).toBe('POST');
      },
    },

    {
      name: 'the-redirect-is-the-hosted-url',
      async run({ expect }) {
        const result = await createIntent({}, []);

        expect(result.url, 'The buyer is sent to the hosted charge').toBe('https://commerce.coinbase.com/charges/FBHJR22R');
        expect(result.id, 'The intent id is the charge id the webhook will name').toBe('8f783fa6-eaa3-4460-af64-cac26b183ed1');
        expect(result.raw.code, 'The raw charge rides along onto the intent doc').toBe('FBHJR22R');
      },
    },

    {
      name: 'charges-a-fixed-price-in-usd',
      async run({ expect }) {
        const calls = [];
        await createIntent({}, calls);

        const body = calls[0].options.body;

        expect(body.pricing_type, 'The buyer pays the price we set, never a donation amount').toBe('fixed_price');
        expect(body.local_price).toEqual({ amount: '49.99', currency: 'USD' });
      },
    },

    {
      name: 'a-validated-discount-comes-off-the-charge',
      async run({ expect }) {
        // The charge is a FIXED price this file computes — Coinbase has no
        // coupon object — so a code the route validated has to be applied here
        // or the buyer pays full price in crypto while the confirmation page
        // reports the discounted amount
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'SAVE10', percent: 10, amount: 0 } }, calls);

        expect(calls[0].options.body.local_price.amount, '10% off $49.99').toBe('44.99');
      },
    },

    {
      name: 'a-flat-discount-comes-off-too',
      async run({ expect }) {
        const calls = [];
        await createIntent({ discount: { valid: true, code: 'TENOFF', percent: 0, amount: 10 } }, calls);

        expect(calls[0].options.body.local_price.amount, '$10 off $49.99').toBe('39.99');
      },
    },

    {
      name: 'carries-the-identifiers-the-pipeline-reads-back',
      async run({ expect }) {
        const calls = [];
        await createIntent({}, calls);

        const metadata = calls[0].options.body.metadata;

        expect(metadata).toEqual({ uid: UID, orderId: ORDER_ID, productId: 'launch-kit' });
        expect(Coinbase.getUid({ metadata }), 'And the library reads its own metadata back').toBe(UID);
        expect(Coinbase.getOrderId({ metadata })).toBe(ORDER_ID);
      },
    },

    {
      name: 'carries-both-redirects',
      async run({ expect }) {
        const calls = [];
        await createIntent({}, calls);

        expect(calls[0].options.body.redirect_url).toBe(CONFIRMATION_URL);
        expect(calls[0].options.body.cancel_url).toBe(CANCEL_URL);
      },
    },

    {
      name: 'refuses-a-subscription-product',
      async run({ expect }) {
        // Coinbase Commerce has no recurring anything. Selling one as a single
        // charge would take the money and grant a plan nothing renews.
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: SUBSCRIPTION_PRODUCT, productId: 'premium', frequency: 'monthly' }, calls);
        } catch (e) {
          threw = true;
          expect(e.message, 'The refusal says why').toMatch(/one-time payment/i);
        }

        expect(threw, 'A subscription must be refused').toBeTruthy();
        expect(calls.length, 'And refused BEFORE Coinbase is called').toBe(0);
      },
    },

    {
      name: 'refuses-an-archived-product',
      async run({ expect }) {
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: { ...ONE_TIME_PRODUCT, archived: true } }, calls);
        } catch (e) {
          threw = true;
          expect(e.message).toMatch(/archived/i);
        }

        expect(threw, 'An archived product must be refused').toBeTruthy();
        expect(calls.length, 'And refused before Coinbase is called').toBe(0);
      },
    },

    {
      name: 'refuses-a-product-with-no-one-time-price',
      async run({ expect }) {
        const calls = [];
        let threw = false;

        try {
          await createIntent({ product: { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: {} } }, calls);
        } catch (e) {
          threw = true;
          expect(e.message).toMatch(/no one-time price/i);
        }

        expect(threw, 'A priceless product must be refused').toBeTruthy();
        expect(calls.length).toBe(0);
      },
    },

    {
      name: 'refuses-a-charge-that-came-back-without-a-page-to-pay-it-on',
      async run({ expect }) {
        let threw = false;

        try {
          await createIntent({}, [], { data: { id: 'ch_no_url', code: 'NOURL123' } });
        } catch (e) {
          threw = true;
          expect(e.message, 'A charge with nowhere to pay it is not an intent').toMatch(/no hosted_url/i);
        }

        expect(threw, 'A urlless charge must throw rather than redirect to undefined').toBeTruthy();
      },
    },
  ],
});
