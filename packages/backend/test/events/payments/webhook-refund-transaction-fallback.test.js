/**
 * Test: a Chargebee refund with no credit note still records what came back
 *
 * The refund's numbers come from Chargebee's own record now, and the envelope's
 * `content.transaction` — whatever the caller posted — is no longer read for them
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)). But a gateway
 * refund issued without a credit note has no credit note to read either, and the
 * untrusted fallback was replaced with nothing: the order record and the
 * customer's refund email were written with `amount: null`
 * ([#534](https://github.com/Omega-JS-Stack/omega/issues/534)).
 *
 * There IS a trusted record for it — the transaction. The envelope's transaction
 * id is the lookup KEY, exactly the trust level the credit-note id already has,
 * and `GET /transactions/{id}` answers with the amount.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js), with
 * Chargebee's credentials + HTTP call — the transport boundary — stubbed.
 *
 * Run: npx omega test backend:events/payments/webhook-refund-transaction-fallback
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');
const Chargebee = require('../../../dist/manager/libraries/payment/providers/chargebee.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-cb-transaction-uid';
const ORDER_ID = '5340-5340-5340';
const INVOICE_ID = 'cb_inv_transaction_fallback';
const TRANSACTION_ID = 'txn_transaction_fallback';
const EVENT_ID = '_test-cb-transaction-evt';

// What the caller claims came back, and what Chargebee's own record says did
const CLAIMED_CENTS = 99999;
const ACTUAL_CENTS = 999;

/** Run fn with Chargebee's credentials + HTTP call replaced by stand-ins */
async function withChargebeeAnswering(request, fn) {
  const realInit = Chargebee.init;
  const realRequest = Chargebee.request;

  Chargebee.init = () => ({ apiKey: '_test', site: '_test', baseUrl: 'https://_test.chargebee.com/api/v2' });
  Chargebee.request = request;

  try {
    return await fn();
  } finally {
    Chargebee.init = realInit;
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

/** The order the completed purchase already wrote — a refund updates it, never defines it */
function existingOrder() {
  return {
    id: ORDER_ID,
    type: 'one-time',
    owner: UID,
    productId: 'premium',
    provider: 'chargebee',
    resourceId: INVOICE_ID,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'completed',
      payment: { provider: 'chargebee', orderId: ORDER_ID, resourceId: INVOICE_ID, price: 9.99 },
    },
    metadata: {
      created: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
      updated: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
    },
  };
}

/** The gateway refund: a transaction, and no credit note anywhere in the event */
function runRefundWithoutCreditNote({ transaction = null, calls = [] } = {}) {
  const responses = {
    [`/invoices/${INVOICE_ID}`]: {
      invoice: {
        id: INVOICE_ID,
        status: 'paid',
        meta_data: JSON.stringify({ uid: UID, orderId: ORDER_ID, productId: 'premium' }),
      },
    },
    [`/transactions/${TRANSACTION_ID}`]: {
      transaction: {
        id: TRANSACTION_ID,
        type: 'refund',
        amount: ACTUAL_CENTS,
        currency_code: 'usd',
        linked_invoices: [{ invoice_id: INVOICE_ID }],
      },
    },
  };

  return withChargebeeAnswering(requestReturning(responses, calls), () => runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: INVOICE_ID,
    eventId: EVENT_ID,
    eventType: 'payment_refunded',
    resourceType: 'invoice',
    category: 'one-time',
    provider: 'chargebee',
    raw: {
      id: EVENT_ID,
      event_type: 'payment_refunded',
      content: {
        invoice: { id: INVOICE_ID },
        // The envelope's own numbers, which are the caller's and are never read
        ...(transaction === null ? { transaction: { id: TRANSACTION_ID, amount: CLAIMED_CENTS, currency_code: 'USD' } } : transaction ? { transaction } : {}),
      },
    },
    seed: { [`payments-orders/${ORDER_ID}`]: existingOrder() },
  }));
}

module.exports = defineCases({
  description: 'A Chargebee refund with no credit note records the transaction\'s amount, never null',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the refund is recorded with the amount Chargebee\'s transaction carries',

      async run() {
        const calls = [];
        const { store } = await runRefundWithoutCreditNote({ calls });
        const refund = store.get(`payments-orders/${ORDER_ID}`)?.unified?.payment?.refund;

        assert.ok(calls.includes(`/transactions/${TRANSACTION_ID}`), 'the transaction is read back by the id the payload names — an identifier, nothing more');
        assert.equal(refund.amount, '9.99', 'the amount is Chargebee\'s record of the transaction');
        assert.notEqual(refund.amount, '999.99', 'and never the number the envelope carried');
        assert.equal(refund.currency, 'USD', 'the currency comes off the same record');
      },
    },

    {
      name: 'the purchase still reads as refunded',

      async run() {
        const { store } = await runRefundWithoutCreditNote();
        const order = store.get(`payments-orders/${ORDER_ID}`);

        assert.equal(order.unified.status, 'refunded', 'the refund lands on the purchase it reversed');
        assert.equal(order.unified.product.id, 'premium', 'which keeps its product');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'completed', 'and the event completes');
      },
    },

    {
      name: 'an event naming neither a credit note nor a transaction still records no amount',

      async run() {
        // Nothing to ask Chargebee about — the refund is recorded with no amount
        // rather than with the payload's, and the gap is said out loud.
        const calls = [];
        const { store, logs } = await runRefundWithoutCreditNote({ transaction: false, calls });
        const refund = store.get(`payments-orders/${ORDER_ID}`)?.unified?.payment?.refund;

        assert.ok(!calls.some((call) => call.startsWith('/transactions/')), 'there is no id to ask about');
        assert.equal(refund.amount, null, 'an unverifiable amount is not invented');
        assert.match(logs.join('\n'), /no credit note/i, 'and the gap is named');
      },
    },
  ],
});
