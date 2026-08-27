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
 * "Unknown resource type" and every such refund failed its lookup.
 *
 * The HTTP call is the one thing stubbed here: reading a capture back needs
 * live PayPal credentials (real PayPal calls are gated behind extended mode,
 * never mocked). Everything under test runs for real.
 *
 * The fixture is PayPal's v2 `Capture` shape, as GET /v2/payments/captures/{id}
 * answers with. What the refund itself moved is a lookup of its own —
 * [refund-details.test.js](refund-details.test.js)
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 *
 * Run: npx omega test backend:helpers/payment/paypal/fetch-capture
 */
const PayPal = require('../../../../src/manager/libraries/payment/providers/paypal.js');

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
          return PayPal.fetchResource('capture', CAPTURE_ID, {});
        });

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
          return PayPal.fetchResource('capture', CAPTURE_ID, {});
        });

        assert.equal(PayPal.getUid(resource), 'test-user-123', 'The uid reads straight off the capture');
        assert.equal(PayPal.getOrderId(resource), 'ord-test-456', 'The orderId reads straight off the capture');
        assert.equal(PayPal.toUnifiedOneTime(resource, {}).product.id, 'credits-100', 'The productId reads straight off the capture');
      },
    },

    {
      name: 'a-failed-fetch-throws-rather-than-answering-with-the-payload',
      async run({ assert }) {
        // The capture the pipeline acts on is the one PayPal answered with. A fetch
        // that fails has no answer to give ([#506]).
        let threw = null;

        try {
          await withPayPalRequest(
            async () => {
              throw new Error('PayPal API unreachable');
            },
            () => PayPal.fetchResource('capture', CAPTURE_ID, {}),
          );
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed fetch must throw');
        assert.equal(threw.notFound, false, 'An unreachable PayPal is transient, not a capture that does not exist');
        assert.match(threw.message, /could not be reached/, 'The failure says the lookup never got an answer');
      },
    },
  ],
};
