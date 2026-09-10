/**
 * Test: Chargebee getRefundDetails()
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 *
 * The refund's amount used to be read out of the webhook envelope — its credit
 * note, or its transaction, whichever the caller posted — and written onto the
 * order record and into the customer's refund email. The resource already in hand
 * is no help: a Chargebee refund lives on the CREDIT NOTE, and the subscription or
 * invoice the event resolves to carries none of its fields.
 *
 * So the credit note is read back by its id — and a refund issued WITHOUT one
 * reads its transaction back the same way, rather than recording no amount at all
 * ([#534](https://github.com/Omega-JS-Stack/omega/issues/534)). Only the id comes
 * from the event, the same trust level as the resourceId every lookup here starts
 * from, and whichever record answers has to link back to the resource the event
 * named ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)).
 *
 * The HTTP call is the one thing stubbed: reading a credit note back needs live
 * Chargebee credentials. Everything under test runs for real.
 *
 * Run: npx omega test backend:helpers/payment/chargebee/refund-details
 */
const Chargebee = require('../../../../dist/manager/libraries/payment/providers/chargebee.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const CREDIT_NOTE_ID = 'cn_test_refund_details';
const ENDPOINT = `/credit_notes/${CREDIT_NOTE_ID}`;

// The record a gateway refund issued without a credit note leaves behind
const TRANSACTION_ID = 'txn_test_refund_details';
const TRANSACTION_ENDPOINT = `/transactions/${TRANSACTION_ID}`;

// The subscription the event resolved to — it knows nothing about the refund
const SUBSCRIPTION_RESOURCE = { id: 'sub_test_refund', status: 'active' };

/** Run fn with the library's HTTP call replaced by a stand-in, restored afterwards */
async function withChargebeeRequest(request, fn) {
  const realRequest = Chargebee.request;

  Chargebee.request = request;

  try {
    return await fn();
  } finally {
    Chargebee.request = realRequest;
  }
}

/** A stand-in that records every endpoint asked for and answers from `responses` */
function requestReturning(responses, calls) {
  return async (endpoint) => {
    calls.push(endpoint);

    const response = responses[endpoint];

    if (!response) {
      const error = new Error(`Chargebee API 404: no stand-in response for ${endpoint}`);
      error.statusCode = 404;
      throw error;
    }

    return JSON.parse(JSON.stringify(response));
  };
}

/** The envelope a payment_refunded event arrives in, claiming an inflated total */
function envelope({ total = 99999, transaction = null } = {}) {
  return {
    id: 'cb-evt-refund',
    event_type: 'payment_refunded',
    content: {
      subscription: SUBSCRIPTION_RESOURCE,
      credit_note: { id: CREDIT_NOTE_ID, total: total, currency_code: 'USD', reason_code: 'fraudulent' },
      ...(transaction ? { transaction: transaction } : {}),
    },
  };
}

module.exports = defineCases({
  description: 'Chargebee getRefundDetails() reads the credit note Chargebee answered for',
  type: 'group',

  tests: [
    {
      name: 'reads-the-credit-note-back-by-its-id',
      async run({ assert }) {
        const calls = [];
        const responses = {
          [ENDPOINT]: { credit_note: { id: CREDIT_NOTE_ID, total: 999, currency_code: 'usd', reason_code: 'product_unsatisfactory' } },
        };

        const details = await withChargebeeRequest(requestReturning(responses, calls), () => {
          return Chargebee.getRefundDetails(SUBSCRIPTION_RESOURCE, { raw: envelope({}) });
        });

        assert.equal(calls.length, 1, 'The credit note is read once');
        assert.equal(calls[0], ENDPOINT, 'By the id the payload names — an identifier, nothing more');
        assert.equal(details.amount, '9.99', 'The amount is Chargebee\'s record of the credit note');
        assert.equal(details.currency, 'USD', 'The currency comes off the same record');
        assert.equal(details.reason, 'product_unsatisfactory', 'And so does the reason');
      },
    },

    {
      name: 'reads-the-transaction-back-when-there-is-no-credit-note',
      async run({ assert }) {
        // A gateway refund issued without a credit note has a trusted record too.
        // Its id is the lookup KEY, exactly like the credit note's — the envelope's
        // own transaction amount is still never read
        // ([#534](https://github.com/Omega-JS-Stack/omega/issues/534)).
        const calls = [];
        const raw = envelope({ transaction: { id: TRANSACTION_ID, amount: 99999, currency_code: 'USD' } });
        const responses = {
          [TRANSACTION_ENDPOINT]: { transaction: { id: TRANSACTION_ID, type: 'refund', amount: 999, currency_code: 'usd', subscription_id: SUBSCRIPTION_RESOURCE.id } },
        };

        delete raw.content.credit_note;

        const details = await withChargebeeRequest(requestReturning(responses, calls), () => {
          return Chargebee.getRefundDetails(SUBSCRIPTION_RESOURCE, { raw: raw, resourceType: 'subscription' });
        });

        assert.equal(calls[0], TRANSACTION_ENDPOINT, 'The transaction is read back by the id the payload names');
        assert.equal(details.amount, '9.99', 'The amount is Chargebee\'s record of the transaction');
        assert.notEqual(details.amount, '999.99', 'Never the number the envelope carried');
        assert.equal(details.currency, 'USD', 'The currency comes off the same record');
      },
    },

    {
      name: 'a-transaction-that-settled-another-subscription-is-refused',
      async run({ assert }) {
        // The fallback's id is the caller's, so it is linked back like every other
        // refund lookup ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)).
        const raw = envelope({ transaction: { id: TRANSACTION_ID, amount: 99999, currency_code: 'USD' } });
        const responses = {
          [TRANSACTION_ENDPOINT]: { transaction: { id: TRANSACTION_ID, type: 'refund', amount: 999, currency_code: 'usd', subscription_id: 'cb_sub_someone_else' } },
        };

        delete raw.content.credit_note;

        let threw = null;

        try {
          await withChargebeeRequest(requestReturning(responses, []), () => {
            return Chargebee.getRefundDetails(SUBSCRIPTION_RESOURCE, { raw: raw, resourceType: 'subscription' });
          });
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A record about another order must not answer for this one');
        assert.equal(threw.refundNotLinked, true, 'It is a linkage refusal, not a lookup failure');
        assert.equal(threw.linkedTo, 'cb_sub_someone_else', 'And it names what the transaction really settled');
      },
    },

    {
      name: 'an-event-naming-neither-record-reports-no-amount',
      async run({ assert }) {
        const warnings = [];
        const calls = [];
        const raw = envelope({});

        delete raw.content.credit_note;

        const details = await withChargebeeRequest(requestReturning({}, calls), () => {
          return Chargebee.getRefundDetails(SUBSCRIPTION_RESOURCE, { raw: raw, ctx: { warn: (m) => warnings.push(m) } });
        });

        assert.equal(calls.length, 0, 'There is nothing to ask Chargebee about');
        assert.equal(details.amount, null, 'The refund is recorded with no amount rather than with the payload\'s');
        assert.equal(warnings.length, 1, 'And the gap is said out loud');
      },
    },

    {
      name: 'a-failed-credit-note-lookup-throws-rather-than-answering-with-the-payload',
      async run({ assert }) {
        // An amount that cannot be verified is not written at all ([#506]).
        let threw = null;

        try {
          await withChargebeeRequest(requestReturning({}, []), () => {
            return Chargebee.getRefundDetails(SUBSCRIPTION_RESOURCE, { raw: envelope({}) });
          });
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed lookup must throw');
        assert.equal(threw.notFound, true, 'A credit note Chargebee does not have is a terminal miss, classified by the same seam');
        assert.equal(threw.resourceType, 'credit_note', 'The failure names the lookup that missed');
        assert.equal(threw.resourceId, CREDIT_NOTE_ID, 'And the id it missed on');
      },
    },
  ],
});
