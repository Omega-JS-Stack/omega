/**
 * Test: PayPal fetchResource('capture')
 * ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
 *
 * One-time purchases this framework creates go through v2 Orders
 * (`POST /v2/checkout/orders/{id}/capture`), and a v2 capture refunds as
 * `PAYMENT.CAPTURE.REFUNDED`. That refund resolves to the CAPTURE it reversed,
 * which reads back at `/v2/payments/captures/{id}` and carries our `custom_id`
 * directly — no `parent_payment` to walk, so the v1 sale branch fits neither
 * the endpoint nor the fold. Without a 'capture' case the fetch fell through to
 * "Unknown resource type" and every such refund took the stale-fallback path.
 *
 * The HTTP call is the one thing stubbed here: reading a capture back needs
 * live PayPal credentials (real PayPal calls are gated behind extended mode,
 * never mocked). Everything under test runs for real.
 *
 * The fixtures are PayPal's v2 shapes: the `Refund` resource a
 * PAYMENT.CAPTURE.REFUNDED event carries (its `up` link naming the capture),
 * and the `Capture` resource GET /v2/payments/captures/{id} answers with.
 *
 * Run: npx omega test backend:helpers/payment/paypal/fetch-capture
 */
const PayPal = require('../../../../src/manager/libraries/payment/processors/paypal.js');

const FIXTURE_CAPTURE_REFUNDED = require('../../../fixtures/paypal/capture-refunded.json');
const FIXTURE_CAPTURE = require('../../../fixtures/paypal/capture-completed.json');

const CAPTURE_ID = FIXTURE_CAPTURE.id;
const CAPTURE_ENDPOINT = `/v2/payments/captures/${CAPTURE_ID}`;

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

module.exports = {
  description: 'PayPal fetchResource() capture retrieval',
  type: 'group',

  tests: [
    {
      name: 'retrieves-the-capture',
      async run({ assert }) {
        const calls = [];
        const responses = { [CAPTURE_ENDPOINT]: FIXTURE_CAPTURE };

        const resource = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.fetchResource('capture', CAPTURE_ID, FIXTURE_CAPTURE_REFUNDED, {});
        });

        assert.equal(resource._stale, undefined, 'A capture the API answered must not be flagged stale');
        assert.equal(resource.id, CAPTURE_ID, 'The capture itself is the resource');
        assert.equal(resource.status, 'REFUNDED', 'The live capture status comes through');
        assert.equal(calls.length, 1, 'The capture should be read once — a v2 capture needs no second call');
        assert.equal(calls[0], CAPTURE_ENDPOINT, 'The fetch should GET the v2 captures endpoint');
      },
    },

    {
      name: 'the-capture-carries-its-identifiers-directly',
      async run({ assert }) {
        // The whole reason the v1 sale branch does not fit: a v2 capture holds
        // our custom_id itself, so nothing has to be folded onto it.
        const responses = { [CAPTURE_ENDPOINT]: FIXTURE_CAPTURE };

        const resource = await withPayPalRequest(requestReturning(responses, []), () => {
          return PayPal.fetchResource('capture', CAPTURE_ID, {}, {});
        });

        assert.equal(PayPal.getUid(resource), 'test-user-123', 'The uid reads straight off the capture');
        assert.equal(PayPal.getOrderId(resource), 'ord-test-456', 'The orderId reads straight off the capture');
        assert.equal(PayPal.toUnifiedOneTime(resource, {}).product.id, 'credits-100', 'The productId reads straight off the capture');
      },
    },

    {
      name: 'a-failed-fetch-still-falls-back-to-the-webhook-payload',
      async run({ assert }) {
        const resource = await withPayPalRequest(
          async () => {
            throw new Error('PayPal API unreachable');
          },
          () => PayPal.fetchResource('capture', CAPTURE_ID, FIXTURE_CAPTURE_REFUNDED, {}),
        );

        assert.equal(resource._stale, true, 'An unreachable API still falls back to the payload, flagged');
        assert.equal(resource.id, FIXTURE_CAPTURE_REFUNDED.id, 'The webhook payload comes through');
      },
    },

    {
      name: 'the-refund-details-read-the-v2-amount-shape',
      async run({ assert }) {
        // v2 spells the amount `value`/`currency_code`; v1 spelled it
        // `total`/`currency`. Reading only the v1 spelling left the refund
        // email and the order record with a null amount.
        const details = PayPal.getRefundDetails({ resource: FIXTURE_CAPTURE_REFUNDED });

        assert.equal(details.amount, '9.99', 'The refunded amount comes off the v2 resource');
        assert.equal(details.currency, 'USD', 'The currency comes off the v2 resource');
      },
    },

    {
      name: 'the-v1-refund-details-still-read-the-v1-shape',
      async run({ assert }) {
        // The v1 sale path is untouched — both spellings resolve.
        const details = PayPal.getRefundDetails({
          resource: { amount: { total: '4.99', currency: 'EUR' }, reason_code: 'REFUND' },
        });

        assert.equal(details.amount, '4.99');
        assert.equal(details.currency, 'EUR');
        assert.equal(details.reason, 'REFUND');
      },
    },
  ],
};
