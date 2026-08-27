/**
 * Test: PayPal getRefundDetails()
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 *
 * The refund's amount used to be read out of the webhook envelope — whatever the
 * caller posted — and written onto the order record and into the customer's
 * refund email. The resource already in hand is no help either: it is the sale or
 * the capture the refund reversed, i.e. the ORIGINAL payment, whose amount is the
 * purchase price and not the refund's, which is simply wrong for a partial refund.
 *
 * So the refund is read back by its OWN id, the one the parser keeps beside the
 * resourceId it reassigns to the sale/capture. Only the id comes from the event —
 * the same trust level as the resourceId every lookup here starts from.
 *
 * The HTTP call is the one thing stubbed: reading a refund back needs live PayPal
 * credentials (real PayPal calls are gated behind extended mode, never mocked).
 *
 * The fixtures are PayPal's own shapes: the v2 `Refund`
 * (`GET /v2/payments/refunds/{id}`, `value`/`currency_code`) and the v1 refund
 * (`GET /v1/payments/refund/{id}`, `total`/`currency`).
 *
 * Run: npx omega test backend:helpers/payment/paypal/refund-details
 */
const PayPal = require('../../../../src/manager/libraries/payment/providers/paypal.js');

const FIXTURE_CAPTURE_REFUNDED = require('../../../fixtures/paypal/capture-refunded.json');

const REFUND_ID = FIXTURE_CAPTURE_REFUNDED.id;
const V2_ENDPOINT = `/v2/payments/refunds/${REFUND_ID}`;
const V1_ENDPOINT = `/v1/payments/refund/${REFUND_ID}`;

// The sale the v1 refund reversed — the resource the pipeline already fetched,
// carrying the price of the PURCHASE, not of the refund
const SALE_RESOURCE = { id: 'SALE-OT', state: 'refunded', amount: { total: '49.99', currency: 'USD' } };

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
      const error = new Error(`PayPal API 404: no stand-in response for ${endpoint}`);
      error.statusCode = 404;
      throw error;
    }

    return JSON.parse(JSON.stringify(response));
  };
}

/** The envelope a refund event arrives in, claiming an inflated total */
function envelope({ amount }) {
  return { id: 'WH-refund', resource: { id: REFUND_ID, amount: amount } };
}

module.exports = {
  description: 'PayPal getRefundDetails() reads the refund PayPal answered for',
  type: 'group',

  tests: [
    {
      name: 'reads-the-v2-refund-back-by-its-own-id',
      async run({ assert }) {
        const calls = [];
        const responses = { [V2_ENDPOINT]: FIXTURE_CAPTURE_REFUNDED };

        const details = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.getRefundDetails({ id: 'CAPTURE-OT', amount: { value: '49.99', currency_code: 'USD' } }, {
            refundId: REFUND_ID,
            eventType: 'PAYMENT.CAPTURE.REFUNDED',
            raw: envelope({ amount: { value: '999.99', currency_code: 'USD' } }),
          });
        });

        assert.equal(calls.length, 1, 'The refund is read once');
        assert.equal(calls[0], V2_ENDPOINT, 'A v2 capture refund reads at the v2 refunds endpoint');
        assert.equal(details.amount, '9.99', 'The amount is PayPal\'s record of the refund');
        assert.equal(details.currency, 'USD', 'And so is the currency');
      },
    },

    {
      name: 'reads-the-v1-refund-at-the-v1-endpoint',
      async run({ assert }) {
        const calls = [];
        const responses = {
          [V1_ENDPOINT]: { id: REFUND_ID, state: 'completed', amount: { total: '4.99', currency: 'EUR' }, reason_code: 'REFUND', sale_id: 'SALE-OT' },
        };

        const details = await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.getRefundDetails(SALE_RESOURCE, {
            refundId: REFUND_ID,
            eventType: 'PAYMENT.SALE.REFUNDED',
            raw: envelope({ amount: { total: '999.99', currency: 'EUR' } }),
          });
        });

        assert.equal(calls[0], V1_ENDPOINT, 'A v1 sale refund reads at the v1 refund endpoint');
        assert.equal(details.amount, '4.99', 'The v1 `total` spelling still resolves');
        assert.equal(details.currency, 'EUR', 'And the v1 `currency` spelling with it');
        assert.equal(details.reason, 'REFUND', 'The reason comes off the refund record');
      },
    },

    {
      name: 'never-answers-with-the-resource-the-refund-reversed',
      async run({ assert }) {
        // The sale is the ORIGINAL payment: reading its amount would report the
        // purchase price as the refund, which a partial refund makes plainly wrong.
        const responses = {
          [V1_ENDPOINT]: { id: REFUND_ID, amount: { total: '4.99', currency: 'USD' } },
        };

        const details = await withPayPalRequest(requestReturning(responses, []), () => {
          return PayPal.getRefundDetails(SALE_RESOURCE, { refundId: REFUND_ID, eventType: 'PAYMENT.SALE.REFUNDED' });
        });

        assert.equal(details.amount, '4.99', 'A partial refund reports what came back, not what was paid');
      },
    },

    {
      name: 'falls-back-to-the-refund-id-the-envelope-carries',
      async run({ assert }) {
        // A doc stored before the parser threaded the id still names the refund in
        // the envelope — an identifier, read the same way resourceId is.
        const calls = [];
        const responses = { [V1_ENDPOINT]: { id: REFUND_ID, amount: { total: '4.99', currency: 'USD' } } };

        await withPayPalRequest(requestReturning(responses, calls), () => {
          return PayPal.getRefundDetails(SALE_RESOURCE, {
            eventType: 'PAYMENT.SALE.REFUNDED',
            raw: envelope({ amount: { total: '999.99', currency: 'USD' } }),
          });
        });

        assert.equal(calls[0], V1_ENDPOINT, 'The envelope\'s refund id is enough to ask PayPal');
      },
    },

    {
      name: 'an-event-naming-no-refund-reports-no-amount',
      async run({ assert }) {
        const warnings = [];
        const calls = [];

        const details = await withPayPalRequest(requestReturning({}, calls), () => {
          return PayPal.getRefundDetails(SALE_RESOURCE, {
            eventType: 'PAYMENT.SALE.REFUNDED',
            raw: { id: 'WH-refund', resource: {} },
            ctx: { warn: (m) => warnings.push(m) },
          });
        });

        assert.equal(calls.length, 0, 'There is nothing to ask PayPal about');
        assert.equal(details.amount, null, 'The refund is recorded with no amount rather than with the payload\'s');
        assert.equal(warnings.length, 1, 'And the gap is said out loud');
      },
    },

    {
      name: 'a-failed-refund-lookup-throws-rather-than-answering-with-the-payload',
      async run({ assert }) {
        // An amount that cannot be verified is not written at all ([#506]).
        let threw = null;

        try {
          await withPayPalRequest(requestReturning({}, []), () => {
            return PayPal.getRefundDetails(SALE_RESOURCE, {
              refundId: REFUND_ID,
              eventType: 'PAYMENT.SALE.REFUNDED',
              raw: envelope({ amount: { total: '999.99', currency: 'USD' } }),
            });
          });
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed lookup must throw');
        assert.equal(threw.notFound, true, 'A refund PayPal does not have is a terminal miss, classified by the same seam');
        assert.equal(threw.resourceType, 'refund', 'The failure names the lookup that missed');
        assert.equal(threw.resourceId, REFUND_ID, 'And the id it missed on');
      },
    },
  ],
};
