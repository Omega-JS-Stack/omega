/**
 * Test: the webhook pipeline's three writes land together or not at all
 *
 * Processing a subscription event writes users/{uid}.subscription, then
 * payments-orders/{orderId}, then payments-intents/{orderId}. As three separate
 * awaits, a throw between them left the user PAID with no order behind it — the
 * order page, the cancel endpoint and the refund lane all read the order, so the
 * split state is invisible until a support ticket ([#219]).
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js) whose
 * payments-orders write rejects. The emulator cannot produce this fault at all —
 * the admin SDK bypasses rules, and all three writes are legal — so the split is
 * only reachable by making one write fail, which is exactly what the stand-in
 * does. The emulator suites stay the integration surface for the happy paths.
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');

const UID = '_test-atomic-uid';
const ORDER_ID = '4242-4242-4242';
const RESOURCE_ID = '_test-atomic-sub';
const EVENT_ID = '_test-atomic-evt';

/** The event this suite is about, with only the failing write left to choose */
function runEvent({ failPath } = {}) {
  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    failPath: failPath,
  });
}

module.exports = {
  description: 'Webhook pipeline writes are atomic (no split payment state)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a healthy event writes the subscription, the order and the intent',

      async run() {
        const { store } = await runEvent();

        assert.equal(store.get(`users/${UID}`)?.subscription?.status, 'active', 'the subscription lands');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`)?.owner, UID, 'the order lands');
        assert.equal(store.get(`payments-intents/${ORDER_ID}`)?.status, 'completed', 'the intent is closed out');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'completed', 'the webhook completes');
      },
    },

    {
      name: 'a failed order write leaves NO subscription behind it',

      async run() {
        const { store } = await runEvent({ failPath: `payments-orders/${ORDER_ID}` });

        assert.ok(!store.get(`users/${UID}`)?.subscription, 'the user must not be left paid with no order');
        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'the order write is the one that failed');
        assert.equal(store.get(`payments-intents/${ORDER_ID}`)?.status, 'failed', 'the failure path still closes the intent');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'failed', 'the webhook is marked failed');
      },
    },
  ],
};
