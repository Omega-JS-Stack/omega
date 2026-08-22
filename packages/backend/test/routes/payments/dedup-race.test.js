/**
 * Test: the webhook and dispute-alert doors deduplicate ATOMICALLY
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * Both routes used to read the doc, then write it. Providers retry, and a retry
 * can arrive while the first delivery is still in flight — in that window both
 * deliveries see no doc and both write, and the pipeline runs the same event
 * twice (for a dispute, that is two refunds). Both routes now claim the doc
 * inside a transaction, so exactly one delivery wins.
 *
 * The race can only be proven by running two deliveries CONCURRENTLY, which is
 * why these ride the direct-handler harness: two handlers in one process,
 * started together, are a real same-instant pair — an HTTP pair would race the
 * network instead of the code.
 *
 * The concurrent pair runs on the WEBHOOK door only, and that is a property of
 * the emulator, not of the fix. The dispute door's own onWrite trigger fails
 * every synthetic alert (no STRIPE_SECRET_KEY, so the charge search throws), and
 * a `failed` doc is by contract RECLAIMABLE — so the losing transaction, which
 * correctly blocks and re-reads, finds a failed doc and legitimately retries.
 * That sanctioned retry is indistinguishable from the bug, so racing it would
 * assert the trigger's timing rather than the claim. The dispute door's claim is
 * the same transaction as the webhook's, and its reclaim contract is pinned
 * below; its duplicate contract is pinned in dispute-alert.test.js.
 *
 * Run: npx omega test backend:routes/payments/dedup-race
 */
const { callHandler } = require('./_route-harness.js');
const { TEST_ACCOUNTS } = require('../../../src/test/test-accounts.js');

const webhookHandler = require('../../../src/manager/routes/payments/webhook/post.js');
const disputeHandler = require('../../../src/manager/routes/payments/dispute-alert/post.js');

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

// The `test` provider fabricates Stripe-shaped events locally and signs nothing,
// so a webhook delivery here never needs a secret or the network.
function deliverWebhook(Manager, eventId) {
  return callHandler({
    Manager,
    handler: webhookHandler,
    functionName: 'payments-webhook',
    req: {
      query: { provider: 'test', key: VALID_KEY() },
      body: {
        id: eventId,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_dedup_race',
            metadata: { uid: TEST_ACCOUNTS.basic.uid },
            status: 'active',
          },
        },
      },
    },
  });
}

function deliverDisputeAlert(Manager, alertId) {
  return callHandler({
    Manager,
    handler: disputeHandler,
    functionName: 'payments-dispute-alert',
    req: {
      query: { key: VALID_KEY() },
      body: {
        id: alertId,
        card: '4242',
        amount: 19.99,
        transactionDate: '2026-03-07',
      },
    },
  });
}

// Exactly one of the two deliveries may be the one that processed.
function assertExactlyOneProcessed(assert, sent, label) {
  sent.forEach((response, index) => {
    assert.equal(response.code, 200, `${label} delivery ${index + 1} should answer 200, got ${response.code}: ${JSON.stringify(response.body)}`);
  });

  const processed = sent.filter((response) => !response.body?.duplicate);
  const duplicates = sent.filter((response) => response.body?.duplicate === true);

  assert.equal(processed.length, 1, `${label}: exactly one delivery may process, got ${processed.length}`);
  assert.equal(duplicates.length, 1, `${label}: the other delivery must be told it is a duplicate, got ${duplicates.length}`);
}

module.exports = {
  description: 'Payment webhook + dispute alert: same-instant deliveries deduplicate',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'two-same-instant-webhook-deliveries-process-once',
      auth: 'none',
      async run({ assert, Manager }) {
        const eventId = '_test-evt-dedup-race';

        const sent = await Promise.all([
          deliverWebhook(Manager, eventId),
          deliverWebhook(Manager, eventId),
        ]);

        assertExactlyOneProcessed(assert, sent, 'webhook');
      },
    },

    {
      name: 'a-failed-webhook-is-still-reclaimable',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const eventId = '_test-evt-dedup-race-retry';

        // The retry path the atomic claim must preserve: a previously FAILED
        // delivery is the one existing state a new delivery may take over.
        await firestore.set(`payments-webhooks/${eventId}`, { id: eventId, status: 'failed', error: 'Previous error' });

        const sent = await deliverWebhook(Manager, eventId);

        assert.equal(sent.code, 200, `A retry should answer 200, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(!sent.body?.duplicate, 'A failed webhook must not be reported as a duplicate');
      },
    },

    {
      name: 'a-failed-dispute-alert-is-still-reclaimable',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const alertId = '_test-dispute-dedup-race-retry';

        await firestore.set(`payments-disputes/${alertId}`, { id: alertId, status: 'failed', error: 'Previous error' });

        const sent = await deliverDisputeAlert(Manager, alertId);

        assert.equal(sent.code, 200, `A retry should answer 200, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(!sent.body?.duplicate, 'A failed dispute alert must not be reported as a duplicate');
      },
    },
  ],
};
