/**
 * Test: PayPal fetchResource('sale')
 * ([#224](https://github.com/Omega-JS-Stack/omega/issues/224)).
 *
 * A PayPal one-time refund (`PAYMENT.SALE.REFUNDED` with no billing agreement)
 * resolves to the SALE it reversed. The library knew subscriptions and orders
 * only, so 'sale' fell through to "Unknown resource type" — every real one-time
 * refund failed its lookup and logged an unreachable provider API, when no fetch
 * had actually been attempted.
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
const PayPal = require('../../../../dist/omega/libraries/payment/providers/paypal.js');

const FIXTURE_SALE_REFUNDED = require('../../../fixtures/paypal/sale-refunded.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

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

module.exports = defineCases({
  description: 'PayPal fetchResource() sale retrieval',
  type: 'group',

  tests: [
    {
      name: 'retrieves-the-sale',
      async run({ expect }) {
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: { ...FIXTURE_SALE_REFUNDED, custom_id: CUSTOM_ID },
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {});
        });

        expect(resource.id, 'The sale itself is the resource').toBe(SALE_ID);
        expect(resource.state, 'The live sale state comes through').toBe('refunded');
        expect(calls.length, 'The sale should be fetched once').toBe(1);
        expect(calls[0], 'The fetch should name the sale').toBe(`/v1/payments/sale/${SALE_ID}`);
      },
    },

    {
      name: 'folds-the-parent-payment-custom-id-onto-the-sale',
      async run({ expect }) {
        // The fixture is a real v1 sale: it carries no custom_id at all, so the
        // payment behind it is the only place uid/orderId/productId live
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: FIXTURE_SALE_REFUNDED,
          [`/v1/payments/payment/${PARENT_PAYMENT_ID}`]: parentPayment(CUSTOM_ID),
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {});
        });

        expect(calls[1], 'The parent payment should be fetched for the identifiers').toBe(`/v1/payments/payment/${PARENT_PAYMENT_ID}`);
        expect(PayPal.getUid(resource), 'The uid should resolve from the parent payment').toBe('test-user-123');
        expect(PayPal.getOrderId(resource), 'The orderId should resolve from the parent payment').toBe('ord-test-456');
        expect(PayPal.toUnifiedOneTime(resource, {}).product.id, 'The productId should resolve from the parent payment').toBe('credits-100');
      },
    },

    {
      name: 'the-sale-own-custom-id-wins',
      async run({ expect }) {
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: { ...FIXTURE_SALE_REFUNDED, custom_id: CUSTOM_ID },
          [`/v1/payments/payment/${PARENT_PAYMENT_ID}`]: parentPayment('uid:stale-user,orderId:ord-stale'),
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {});
        });

        expect(PayPal.getUid(resource), 'The sale is the newer record of the two').toBe('test-user-123');
        expect(calls.length, 'A sale that names its own custom_id needs no second call').toBe(1);
      },
    },

    {
      name: 'an-unreadable-parent-payment-still-returns-the-live-sale',
      async run({ expect }) {
        // The identifiers are best-effort: losing them must not throw away the
        // fresh sale and demote the whole event to the stale payload
        const calls = [];
        const responses = {
          [`/v1/payments/sale/${SALE_ID}`]: FIXTURE_SALE_REFUNDED,
        };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('sale', SALE_ID, {});
        });

        expect(resource.id, 'The live sale still comes through').toBe(SALE_ID);
        expect(PayPal.getUid(resource), 'No identifiers were folded, so the pipeline resolves them elsewhere').toBe(null);
        expect(calls.length, 'The parent payment was attempted').toBe(2);
      },
    },

    {
      name: 'a-failed-fetch-throws-rather-than-answering-with-the-payload',
      async run({ expect }) {
        // The sale the pipeline acts on is the one PayPal answered with. A fetch
        // that fails has no answer to give ([#506]).
        let threw = null;

        try {
          await withPayPalRequest(
            async () => {
              throw new Error('PayPal API unreachable');
            },
            () => PayPal.fetchResource('sale', SALE_ID, {}),
          );
        } catch (e) {
          threw = e;
        }

        expect(threw, 'A failed fetch must throw').toBeTruthy();
        expect(threw.notFound, 'An unreachable PayPal is transient, not a sale that does not exist').toBe(false);
        expect(threw.message, 'The failure says the lookup never got an answer').toMatch(/could not be reached/);
      },
    },
  ],
});
