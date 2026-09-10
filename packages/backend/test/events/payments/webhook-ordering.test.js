/**
 * Test: webhook robustness — ordering, staleness, unknown types, and the update
 * that changes nothing
 *
 * Providers do not promise delivery order. Stripe says so outright, PayPal
 * retries on its own schedule, and a redelivery of an old event can land after
 * a newer one has already been applied. The pipeline's answer is a STALENESS
 * CLOCK: the second the event arrived (`metadata.created.timestampUNIX`, written
 * by the webhook route) against the second the order was last written. Older
 * loses, and loses SILENTLY — no subscription write, no order write, no
 * transition, no conversion ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The clock only exists when the event resolves an ORDER. Without one the guard
 * cannot run at all, and the pipeline says so out loud rather than pretending it
 * checked — that warning is the only signal a human gets, so it is pinned here.
 *
 * Also here: the two shapes that must produce nothing rather than something
 * wrong. An event category the pipeline does not know is a parser fault, not a
 * payment — it fails loudly instead of guessing a branch. And a payment-method
 * update (the expiring-card round trip) is a real `customer.subscription.updated`
 * that changes no subscription state at all: the correct outcome is the state
 * refreshed and NO transition, because there is no email to send about a card.
 *
 * Plain-node (no emulator, no network): the real trigger over the shared
 * in-memory Firestore stand-in, which is the only way to hand one run an order
 * already written into an exact prior second.
 *
 * Run: npx omega test backend:events/payments/webhook-ordering
 */
const assert = require('node:assert');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-ordering-uid';
const ORDER_ID = '_test-ordering-order';
const RESOURCE_ID = '_test-ordering-sub';

const nowUNIX = () => Math.floor(Date.now() / 1000);

/** A `$timestamp` pair from a UNIX second */
function stamp(unix) {
  return { timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix };
}

/**
 * An order already on file, last written at `updatedUNIX`
 *
 * @param {number} updatedUNIX - The second the order was last written
 * @param {object} [unified] - Overrides for the unified subscription it holds
 * @returns {object}
 */
function existingOrder(updatedUNIX, unified = {}) {
  return {
    id: ORDER_ID,
    type: 'subscription',
    owner: UID,
    productId: 'premium',
    provider: 'test',
    resourceId: RESOURCE_ID,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      cancellation: { pending: false },
      payment: { provider: 'test', resourceId: RESOURCE_ID, frequency: 'monthly', price: 4.99 },
      ...unified,
    },
    metadata: { created: stamp(updatedUNIX - 60), updated: stamp(updatedUNIX) },
  };
}

/** A user already subscribed, so a skipped event has something to leave alone */
function existingUser(status = 'active') {
  return {
    auth: { email: 'ordering@example.com' },
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: status,
      cancellation: { pending: false },
      payment: { provider: 'test', resourceId: RESOURCE_ID, frequency: 'monthly', price: 4.99 },
    },
  };
}

module.exports = defineCases({
  description: 'Webhook robustness: out-of-order delivery, unknown types, and no-op updates',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'an-event-older-than-the-order-is-skipped-whole',

      async run() {
        // The redelivery case: a cancellation from ten minutes ago arrives after
        // the order was already written by something newer.
        const orderWrittenUNIX = nowUNIX();

        const { store, logs } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-stale',
          eventType: 'customer.subscription.deleted',
          receivedUNIX: orderWrittenUNIX - 600,
          payload: { ...subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }), status: 'canceled' },
          seed: {
            [`users/${UID}`]: existingUser(),
            [`payments-orders/${ORDER_ID}`]: existingOrder(orderWrittenUNIX),
          },
        });

        assert.equal(store.get(`users/${UID}`).subscription.status, 'active', 'the newer state stands — a stale event must not cancel a live subscriber');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`).metadata.updated.timestampUNIX, orderWrittenUNIX, 'the order is untouched, down to its write stamp');
        assert.equal(store.get(`payments-webhooks/_test-ordering-stale`).transition, null, 'a skipped event dispatches no transition, so no cancellation email goes out');
        assert.equal(store.get(`payments-webhooks/_test-ordering-stale`).status, 'completed', 'it is still acknowledged — the provider must stop redelivering it');
        assert.ok(logs.some((line) => line.includes('Stale webhook')), `the skip is logged by name, got: ${logs.join(' | ')}`);
      },
    },

    {
      name: 'an-event-newer-than-the-order-is-applied',

      async run() {
        // The control: the same event, arriving in order, must still land — the
        // guard is a tiebreaker, never a brake.
        const orderWrittenUNIX = nowUNIX() - 600;

        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-fresh',
          eventType: 'customer.subscription.deleted',
          receivedUNIX: nowUNIX(),
          payload: { ...subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }), status: 'canceled' },
          seed: {
            [`users/${UID}`]: existingUser(),
            [`payments-orders/${ORDER_ID}`]: existingOrder(orderWrittenUNIX),
          },
        });

        assert.equal(store.get(`users/${UID}`).subscription.status, 'cancelled', 'the newer event is the one that decides');
        assert.equal(store.get(`payments-webhooks/_test-ordering-fresh`).transition, 'subscription-cancelled', 'and it dispatches its transition');
      },
    },

    {
      name: 'an-event-from-the-orders-own-second-is-applied',

      async run() {
        // The tie. `<` is the comparison, so equal seconds are NOT stale — two
        // events inside one second are ordered by arrival, and refusing the
        // second would drop a legitimate follow-up (a subscription event and its
        // invoice event routinely land together).
        const orderWrittenUNIX = nowUNIX();

        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-tie',
          eventType: 'customer.subscription.deleted',
          receivedUNIX: orderWrittenUNIX,
          payload: { ...subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }), status: 'canceled' },
          seed: {
            [`users/${UID}`]: existingUser(),
            [`payments-orders/${ORDER_ID}`]: existingOrder(orderWrittenUNIX),
          },
        });

        assert.equal(store.get(`users/${UID}`).subscription.status, 'cancelled', 'a same-second event is a follow-up, not a redelivery');
      },
    },

    {
      name: 'an-event-with-no-order-says-the-guard-could-not-run',

      async run() {
        // The clock keys on the order. Without one there is nothing to compare
        // against, so the event is applied unguarded — and the warning is the
        // only thing that makes that window visible to a human.
        const { store, logs } = await runTrigger({
          uid: UID,
          orderId: null,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-no-order',
          payload: { ...subscriptionPayload({ uid: UID, orderId: null, resourceId: RESOURCE_ID }), metadata: { uid: UID } },
          seed: { [`users/${UID}`]: existingUser() },
        });

        assert.ok(
          logs.some((line) => line.includes('the staleness guard cannot run')),
          `an unguarded event must announce itself, got: ${logs.join(' | ')}`,
        );
        assert.equal(store.get(`payments-webhooks/_test-ordering-no-order`).status, 'completed', 'and it is still processed — an unguarded event is not a refused one');
      },
    },

    {
      name: 'an-unknown-event-category-fails-loudly-and-writes-nothing',

      async run() {
        // Every category that reaches here came from a provider's own parser, so
        // one the pipeline does not know is a parser fault. It must not guess a
        // branch: the doc fails, the retry sweep gets it, and a human sees it.
        const { store, logs } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-unknown-category',
          category: 'donation',
          seed: { [`users/${UID}`]: existingUser() },
        });

        const webhook = store.get(`payments-webhooks/_test-ordering-unknown-category`);

        assert.equal(webhook.status, 'failed', 'an unknown category fails rather than picking a branch');
        assert.ok(webhook.error.includes('Unknown event category'), `the error names what went wrong, got: ${webhook.error}`);
        assert.equal(webhook.retryCount, 1, 'and it enters the retry ladder like any other failure');
        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'nothing is written for an event nothing could interpret');
        assert.ok(logs.some((line) => line.includes('Unknown event category')), 'the failure is logged');
      },
    },

    {
      name: 'an-event-with-no-category-fails-before-it-loads-a-library',

      async run() {
        // The route drops a categoryless event at the door, so one arriving here
        // means something wrote the doc directly — the pipeline still refuses it.
        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-no-category',
          category: null,
          seed: { [`users/${UID}`]: existingUser() },
        });

        const webhook = store.get(`payments-webhooks/_test-ordering-no-category`);

        assert.equal(webhook.status, 'failed', 'a categoryless event cannot be processed');
        assert.ok(webhook.error.includes('no category'), `the error names what is missing, got: ${webhook.error}`);
      },
    },

    {
      name: 'a-payment-method-update-refreshes-state-and-emails-nobody',

      async run() {
        // The expiring-card round trip. A customer updates their card in the
        // portal and the provider sends `customer.subscription.updated` — the
        // subscription is identical on both sides of it. The pipeline must
        // re-write the state (the card is what changed, and the portal is the
        // only place that knows) and detect NO transition: every rule in the
        // table describes money or access moving, and neither did.
        const orderWrittenUNIX = nowUNIX() - 600;

        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-payment-method',
          eventType: 'customer.subscription.updated',
          payload: {
            ...subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }),
            default_payment_method: 'pm_test_new_card',
          },
          seed: {
            [`users/${UID}`]: existingUser(),
            [`payments-orders/${ORDER_ID}`]: existingOrder(orderWrittenUNIX),
          },
        });

        const webhook = store.get(`payments-webhooks/_test-ordering-payment-method`);
        const user = store.get(`users/${UID}`);

        assert.equal(webhook.status, 'completed', 'the event is processed, not ignored');
        assert.equal(webhook.transition, null, 'a new card is not a transition — nothing about the subscription changed');
        assert.equal(user.subscription.status, 'active', 'the subscriber stays active across a card change');
        assert.equal(user.subscription.product.id, 'premium', 'and keeps their plan');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`).unified.status, 'active', 'the order mirrors the refreshed state');
        assert.equal(store.get(`payments-intents/${ORDER_ID}`).status, 'completed', 'and the intent is closed out with it');
      },
    },

    {
      name: 'a-redelivered-completion-writes-state-again-but-emails-once',

      async run() {
        // Idempotency at the pipeline, not just the door: the route reclaims a
        // failed doc, so the trigger can legitimately see one event twice. The
        // state write is idempotent by construction (same resource, same answer);
        // the EMAIL is not, so the one-time side suppresses on the second pass.
        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: '_test-ordering-redelivered',
          eventType: 'checkout.session.completed',
          category: 'one-time',
          resourceType: 'session',
          previouslyCompleted: true,
          payload: {
            id: RESOURCE_ID,
            object: 'checkout.session',
            mode: 'payment',
            status: 'complete',
            amount_total: 499,
            currency: 'usd',
            metadata: { uid: UID, orderId: ORDER_ID, productId: 'premium' },
          },
          seed: {
            [`users/${UID}`]: existingUser(),
            [`payments-orders/${ORDER_ID}`]: { ...existingOrder(nowUNIX() - 600), type: 'one-time' },
          },
        });

        const webhook = store.get(`payments-webhooks/_test-ordering-redelivered`);

        assert.equal(webhook.status, 'completed', 'a redelivery is acknowledged like any other pass');
        assert.equal(webhook.transition, null, 'and dispatches nothing — the confirmation email already went out on the first pass');
      },
    },
  ],
});
