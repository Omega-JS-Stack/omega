/**
 * Test: PayPal fetchResource('sale')
 * ([#224](https://github.com/Omega-JS-Stack/omega/issues/224)).
 *
 * A PayPal one-time refund (`PAYMENT.SALE.REFUNDED` with no billing agreement)
 * resolves to the SALE it reversed. The library knew subscriptions and orders
 * only, so 'sale' fell through to "Unknown resource type" — every real one-time
 * refund took the stale-fallback path and logged the failure as an unreachable
 * provider API, when no fetch had actually been attempted.
 *
 * The HTTP call is the one thing stubbed here: reading a sale back needs live
 * PayPal credentials (real PayPal calls are gated behind extended mode, never
 * mocked). Everything under test runs for real — the branch, the parent-payment
 * fold, and the identifiers a sale inherits from the payment that created it.
 *
 * The sale fixture is PayPal's v1 `Sale` resource as GET /v1/payments/sale/{id}
 * answers it (`state`, `parent_payment`, `transaction_fee`, HATEOAS links, and
 * no custom_id — a v1 sale never carries one).
 *
 * Run: npx omega test backend:helpers/payment/paypal/fetch-sale
 */
const PayPal = require('../../../../src/manager/libraries/payment/providers/paypal.js');

const FIXTURE_SALE_REFUNDED = require('../../../fixtures/paypal/sale-refunded.json');

const SALE_ID = FIXTURE_SALE_REFUNDED.id;
const PARENT_PAYMENT_ID = FIXTURE_SALE_REFUNDED.parent_payment;
const CUSTOM_ID = 'uid:test-user-123,orderId:ord-test-456,productId:credits-100';

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

/** A stand-in that records every endpoint asked for and answers from `responses` */
function requestReturning(responses, calls) {
  return async (endpoint) => {
    calls.push(endpoint);

    const response = responses[endpoint];

    if (!response) {
      throw new Error(`PayPal API 404: no stand-in response for ${endpoint}`);
    }

    return typeof response === 'function' ? response() : JSON.parse(JSON.stringify(response));
  };
}

/** The v1 payment behind a sale — its transaction is where custom_id lives */
function parentPayment(custom) {
  return {
    id: PARENT_PAYMENT_ID,
    intent: 'sale',
    state: 'approved',
    transactions: [
      {
        amount: { total: '9.99', currency: 'USD' },
        custom: custom,
        related_resources: [{ sale: { id: SALE_ID } }],
      },
    ],
  };
}

module.exports = {
  description: 'PayPal fetchResource() sale retrieval',
  type: 'group',

  tests: [
    {
      name: 'retrieves-the-sale',
      async run({ assert }) {
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: { ...FIXTURE_SALE_REFUNDED, custom_id: CUSTOM_ID },
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, { id: 'REFUND-OT', sale_id: SALE_ID }, {});
        });

        assert.equal(resource._stale, undefined, 'A sale the API answered must not be flagged stale');
        assert.equal(resource.id, SALE_ID, 'The sale itself is the resource');
        assert.equal(resource.state, 'refunded', 'The live sale state comes through');
        assert.equal(calls.length, 1, 'The sale should be fetched once');
        assert.equal(calls[0], `/v1/payments/sale/${SALE_ID}`, 'The fetch should name the sale');
      },
    },

    {
      name: 'folds-the-parent-payment-custom-id-onto-the-sale',
      async run({ assert }) {
        // The fixture is a real v1 sale: it carries no custom_id at all, so the
        // payment behind it is the only place uid/orderId/productId live
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: FIXTURE_SALE_REFUNDED,
          [`/v1/payments/payment/${PARENT_PAYMENT_ID}`]: parentPayment(CUSTOM_ID),
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {}, {});
        });

        assert.equal(resource._stale, undefined, 'The API answered, so nothing is stale');
        assert.equal(calls[1], `/v1/payments/payment/${PARENT_PAYMENT_ID}`, 'The parent payment should be fetched for the identifiers');
        assert.equal(PayPal.getUid(resource), 'test-user-123', 'The uid should resolve from the parent payment');
        assert.equal(PayPal.getOrderId(resource), 'ord-test-456', 'The orderId should resolve from the parent payment');
        assert.equal(PayPal.toUnifiedOneTime(resource, {}).product.id, 'credits-100', 'The productId should resolve from the parent payment');
      },
    },

    {
      name: 'the-sale-own-custom-id-wins',
      async run({ assert }) {
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: { ...FIXTURE_SALE_REFUNDED, custom_id: CUSTOM_ID },
          [`/v1/payments/payment/${PARENT_PAYMENT_ID}`]: parentPayment('uid:stale-user,orderId:ord-stale'),
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {}, {});
        });

        assert.equal(PayPal.getUid(resource), 'test-user-123', 'The sale is the newer record of the two');
        assert.equal(calls.length, 1, 'A sale that names its own custom_id needs no second call');
      },
    },

    {
      name: 'an-unreadable-parent-payment-still-returns-the-live-sale',
      async run({ assert }) {
        // The identifiers are best-effort: losing them must not throw away the
        // fresh sale and demote the whole event to the stale payload
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: FIXTURE_SALE_REFUNDED,
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, { id: 'REFUND-OT', custom_id: CUSTOM_ID }, {});
        });

        assert.equal(resource._stale, undefined, 'The sale was read live — only its identifiers were lost');
        assert.equal(resource.id, SALE_ID, 'The live sale still comes through');
        assert.equal(PayPal.getUid(resource), null, 'No identifiers were folded, so the pipeline resolves them elsewhere');
        assert.equal(calls.length, 2, 'The parent payment was attempted');
      },
    },

    {
      name: 'a-failed-fetch-still-falls-back-to-the-webhook-payload',
      async run({ assert }) {
        const payload = { id: 'REFUND-OT', sale_id: SALE_ID, custom_id: CUSTOM_ID };

        const resource = await withPayPalRequest(
          async () => {
            throw new Error('PayPal API unreachable');
          },
          () => PayPal.fetchResource('sale', SALE_ID, payload, {}),
        );

        assert.equal(resource._stale, true, 'An unreachable API still falls back to the payload, flagged');
        assert.equal(resource.id, 'REFUND-OT', 'The webhook payload comes through');
      },
    },
  ],
};
