/**
 * Test: a failed webhook is retried by the frequent cron, then dead-lettered
 *
 * The webhook route 200s the provider immediately and the trigger does the work,
 * so a doc the trigger marked `failed` was terminal — a transient fault (a provider
 * API blip, a Firestore write that lost a race) dropped the payment on the floor and
 * nothing ever picked it up again ([#220]).
 *
 * Retrying is only safe if reprocessing the same event is safe, which the first two
 * steps prove against the real pipeline before the sweep is exercised at all: the
 * second pass writes the same state and detects NO transition, so nobody is emailed
 * about the same subscription twice.
 */
const powertools = require('node-powertools');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// The suite's own seeded persona ([#406](https://github.com/Omega-JS-Stack/omega/issues/406)):
// exclusive to this suite, declared in the seed roster, and the half the seed
// owns here is the AUTH USER — the doc is deleted below on purpose.
const PERSONA = 'webhook-retry-sweep';
const ORDER_ID = '5150-5150-5150';

// Written into `transition` before the doc is put back to pending — the completion
// write overwrites it, so waiting on it gone is waiting on the SECOND pass, not the first
const REPROCESS_SENTINEL = '_awaiting-reprocess';

// The ceiling the sweep stops re-flipping at (retry-failed-webhooks.js MAX_RETRIES)
const MAX_RETRIES = 5;

module.exports = defineCases({
  description: 'Failed webhooks retry on the frequent cron, then dead-letter',
  type: 'suite',
  timeout: 180000,

  tests: [
    {
      name: 'reset-prior-state',
      async run({ accounts, firestore, state }) {
        state.uid = accounts[PERSONA].uid;

        // The pipeline writes this subscriber's doc from scratch, so the seeded doc
        // comes off first — the auth user behind it is what makes the write legal at
        // all ([#399]) — and the fixed order/intent ids go with it, or a previous
        // run's leftovers would make the first pass a plan change instead of a new
        // subscription
        await firestore.delete(`users/${state.uid}`);
        await firestore.delete(`payments-orders/${ORDER_ID}`);
        await firestore.delete(`payments-intents/${ORDER_ID}`);

        state.orderId = ORDER_ID;
      },
    },

    {
      name: 'process-a-subscription-webhook',
      async run({ http, firestore, assert, waitFor, state, config, payments, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);

        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.productId = paidProduct.id;
        state.resourceId = `_test-retry-sub-${Date.now()}`;
        state.eventId = `_test-evt-retry-${Date.now()}`;

        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId,
          type: 'customer.subscription.updated',
          data: {
            object: subscriptionResource({
              resourceId: state.resourceId,
              uid: state.uid,
              orderId: ORDER_ID,
              stripeProductId: payments.stripeProductIds[paidProduct.id],
              interval: payments.products[paidProduct.id].interval,
            }),
          },
        });

        assert.isSuccess(response, 'Webhook should be accepted');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        const userDoc = await firestore.get(`users/${state.uid}`);
        const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);

        assert.equal(webhookDoc.transition, 'new-subscription', 'The first pass is the one that emails the customer');
        assert.equal(userDoc.subscription.status, 'active', 'The subscription is active');
        assert.equal(userDoc.subscription.product.id, paidProduct.id, `The subscription is ${paidProduct.id}`);
        assert.equal(orderDoc.owner, state.uid, 'The order was written');

        state.orderCreatedUNIX = orderDoc.metadata.created.timestampUNIX;
        state.expiresUNIX = userDoc.subscription.expires.timestampUNIX;
      },
    },

    {
      name: 'reprocessing-the-same-event-changes-nothing',
      async run({ firestore, assert, waitFor, state }) {
        // Exactly what a retry does: the same doc, put back to pending
        await firestore.set(`payments-webhooks/${state.eventId}`, {
          status: 'pending',
          transition: REPROCESS_SENTINEL,
        }, { merge: true });

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed' && doc?.transition !== REPROCESS_SENTINEL;
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        const userDoc = await firestore.get(`users/${state.uid}`);
        const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);

        assert.equal(webhookDoc.transition, null, 'The second pass detects no transition — no second welcome email');
        assert.equal(userDoc.subscription.status, 'active', 'The subscription is unchanged');
        assert.equal(userDoc.subscription.product.id, state.productId, 'The product is unchanged');
        assert.equal(userDoc.subscription.expires.timestampUNIX, state.expiresUNIX, 'The expiry is unchanged');
        assert.equal(orderDoc.owner, state.uid, 'The order still belongs to the same user');
        assert.equal(orderDoc.metadata.created.timestampUNIX, state.orderCreatedUNIX, 'The order is the SAME order, not a second one');
      },
    },

    {
      name: 'a-failing-webhook-counts-its-attempt',
      async run({ http, firestore, assert, waitFor, state, config, payments }) {
        state.failedEventId = `_test-evt-retry-fail-${Date.now()}`;
        state.failedResourceId = `_test-retry-fail-sub-${Date.now()}`;
        state.failedOrderId = '5151-5151-5151';

        // No uid anywhere the pipeline can reach — the trigger throws on it
        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.failedEventId,
          type: 'customer.subscription.updated',
          data: {
            object: subscriptionResource({
              resourceId: state.failedResourceId,
              orderId: state.failedOrderId,
              stripeProductId: payments.stripeProductIds[state.productId],
              interval: payments.products[state.productId].interval,
            }),
          },
        });

        assert.isSuccess(response, 'Webhook should be accepted (it fails during processing, not at the door)');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.failedEventId}`);
          return doc?.status === 'failed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.failedEventId}`);

        assert.match(webhookDoc.error, /no UID/i, 'The webhook failed on the unresolvable UID');
        assert.equal(webhookDoc.retryCount, 1, 'The failed attempt is counted');
        assert.ok(!webhookDoc.deadLetter, 'One failure is nowhere near the ceiling');
      },
    },

    {
      name: 'the-sweep-recovers-it',
      timeout: 120000,
      async run({ firestore, assert, waitFor, pubsub, state }) {
        // Heal what made it fail — the owner the payload never carried. This is the
        // transient fault standing in for a provider blip: the next pass succeeds.
        await firestore.set(`payments-webhooks/${state.failedEventId}`, { owner: state.uid }, { merge: true });

        await pubsub.trigger('omega_cronFrequent');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.failedEventId}`);
          return doc?.status === 'completed';
        }, 90000, 1000);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.failedEventId}`);

        assert.equal(webhookDoc.status, 'completed', 'The sweep put it back to pending and the retry completed it');
        assert.equal(webhookDoc.retryCount, 1, 'A successful retry does not count another attempt');
        assert.equal(webhookDoc.owner, state.uid, 'It processed as the recovered owner');
      },
    },

    {
      name: 'the-ceiling-dead-letters-instead-of-retrying-forever',
      timeout: 120000,
      async run({ firestore, assert, waitFor, pubsub, state, payments }) {
        const now = powertools.timestamp(new Date(), { output: 'string' });
        state.deadEventId = `_test-evt-retry-dead-${Date.now()}`;

        // A doc that already burned every retry — seeded failed, so nothing processes
        // it until the sweep decides whether to
        await firestore.set(`payments-webhooks/${state.deadEventId}`, {
          id: state.deadEventId,
          provider: 'test',
          status: 'failed',
          retryCount: MAX_RETRIES,
          error: 'Webhook event has no UID',
          raw: { id: state.deadEventId, type: 'customer.subscription.updated', data: { object: subscriptionResource({ resourceId: `_test-retry-dead-sub-${Date.now()}`, orderId: '5152-5152-5152', stripeProductId: payments.stripeProductIds[state.productId], interval: payments.products[state.productId].interval }) } },
          owner: null,
          event: { type: 'customer.subscription.updated', category: 'subscription', resourceType: 'subscription', resourceId: `_test-retry-dead-sub-${Date.now()}` },
          metadata: {
            created: {
              timestamp: now,
              timestampUNIX: powertools.timestamp(now, { output: 'unix' }),
            },
          },
        });

        await pubsub.trigger('omega_cronFrequent');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.deadEventId}`);
          return doc?.deadLetter === true;
        }, 90000, 1000);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.deadEventId}`);

        assert.equal(webhookDoc.deadLetter, true, 'The doc at the ceiling is dead-lettered');
        assert.equal(webhookDoc.status, 'failed', 'It is NOT put back to pending');
        assert.equal(webhookDoc.retryCount, MAX_RETRIES, 'Dead-lettering counts no further attempt');
      },
    },
  ],
});

/**
 * A Stripe-shaped active subscription — the shape the test provider speaks
 * Omitting uid is what makes the pipeline fail on an unresolvable owner
 */
function subscriptionResource({ resourceId, uid, orderId, stripeProductId, interval }) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: resourceId,
    object: 'subscription',
    status: 'active',
    metadata: uid ? { uid, orderId } : { orderId },
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_start: nowUNIX,
    current_period_end: nowUNIX + 86400 * 30,
    start_date: nowUNIX,
    trial_start: null,
    trial_end: null,
    plan: { product: stripeProductId, interval: interval },
  };
}
