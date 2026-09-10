/**
 * Test: POST /payments/intent — what a one-time checkout stamps on the charge
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A one-time Checkout Session carries the productId in its OWN metadata, but the
 * charge Stripe creates behind it only inherits `payment_intent_data.metadata` —
 * which carried uid and orderId alone. So the refund of that purchase arrived as
 * a charge that could not say what was bought, at the provider or anywhere the
 * charge is read on its own.
 *
 * The SDK is the one thing stubbed: creating a session needs a live Stripe
 * account. The price lookup, the customer resolution and the session params
 * themselves are the real code paths.
 *
 * Run: npx omega test backend:routes/payments/intent-one-time-metadata
 */
const StripeLib = require('../../../dist/manager/libraries/payment/providers/stripe.js');
const stripeIntent = require('../../../dist/manager/routes/payments/intent/providers/stripe.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-intent-metadata-uid';
const ORDER_ID = '1212-3434-5656';

const ONE_TIME_PRODUCT = {
  id: 'credits-100',
  name: '100 Credits',
  type: 'one-time',
  prices: { once: 9.99 },
  stripe: { productId: 'prod_test_credits' },
};

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

/** A stand-in SDK that answers the lookups and records the session it was asked to create */
function sdkCapturing(captured) {
  return {
    prices: {
      list: () => [{ id: 'price_test_once', unit_amount: 999, recurring: null, product: 'prod_test_credits' }],
    },
    customers: {
      search: async () => ({ data: [{ id: 'cus_test_intent_metadata' }] }),
    },
    checkout: {
      sessions: {
        create: async (params) => {
          captured.params = params;
          return { id: 'cs_test_intent_metadata', url: 'https://checkout.example/cs_test_intent_metadata' };
        },
      },
    },
  };
}

function buildCtx() {
  return {
    log: () => {},
    getUser: () => ({ auth: { email: `${UID}@example.com` } }),
  };
}

async function createOneTimeIntent() {
  const captured = {};

  await withStripeSdk(sdkCapturing(captured), () => stripeIntent.createIntent({
    uid: UID,
    orderId: ORDER_ID,
    product: ONE_TIME_PRODUCT,
    productId: ONE_TIME_PRODUCT.id,
    frequency: null,
    trial: false,
    discount: null,
    confirmationUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    ctx: buildCtx(),
  }));

  return captured.params;
}

module.exports = defineCases({
  description: 'Payment intent: one-time charge metadata',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'stamps-the-product-on-the-payment-intent',
      auth: 'none',
      async run({ assert }) {
        const params = await createOneTimeIntent();

        assert.equal(params.mode, 'payment', 'A one-time product checks out in payment mode');
        assert.equal(params.payment_intent_data.metadata.productId, ONE_TIME_PRODUCT.id, 'The charge must be able to say what was bought');
        assert.equal(params.payment_intent_data.metadata.uid, UID, 'The uid stays on the charge');
        assert.equal(params.payment_intent_data.metadata.orderId, ORDER_ID, 'The orderId stays on the charge');
      },
    },

    {
      name: 'the-session-metadata-is-unchanged',
      auth: 'none',
      async run({ assert }) {
        const params = await createOneTimeIntent();

        assert.equal(params.metadata.productId, ONE_TIME_PRODUCT.id, 'The session still carries the product');
        assert.equal(params.metadata.uid, UID, 'The session still carries the uid');
        assert.equal(params.metadata.orderId, ORDER_ID, 'The session still carries the orderId');
      },
    },
  ],
});
