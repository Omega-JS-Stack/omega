/**
 * Test: POST /payments/refund — refunding a ONE-TIME purchase
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The route was subscription-shaped end to end: it read the caller's
 * `user.subscription` and rejected anybody without a paid one, so a one-time
 * purchase — which never touches the user doc at all — could not be refunded
 * through it. A one-time refund names its subject in the request instead: the
 * `payments-orders` doc of the purchase.
 *
 * The guards are the point of this suite, so it calls the handler DIRECTLY: each
 * case gets exactly the order doc it is about, without minting a persona per
 * permutation. The one valid order deliberately carries an unknown processor —
 * reaching "Unknown processor" proves the request got PAST every guard without
 * anything external being touched.
 *
 * Run: npx omega test backend:routes/payments/refund-one-time
 */
const { buildUser, callHandler } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/refund/post.js');

const OWNER = '_test-refund-one-time-owner';

function purchaser(Manager, uid) {
  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    // A one-time buyer is an ordinary Basic user — the whole point of the branch
    subscription: { product: { id: 'basic' }, status: 'active' },
  });
}

// A completed one-time order, the shape the webhook pipeline writes
function oneTimeOrder(orderId, overrides) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: orderId,
    type: 'one-time',
    owner: OWNER,
    productId: 'credits-100',
    processor: 'unknown-processor',
    resourceId: `_test-cs-${orderId}`,
    unified: {
      product: { id: 'credits-100', name: '100 Credits' },
      status: 'completed',
      payment: { processor: 'unknown-processor', orderId: orderId, resourceId: `_test-cs-${orderId}`, price: 9.99 },
    },
    requests: { cancellation: null, refund: null },
    metadata: { created: { timestamp: new Date(nowUNIX * 1000).toISOString(), timestampUNIX: nowUNIX } },
    ...(overrides || {}),
  };
}

function refund(Manager, user, orderId) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-refund',
    user,
    settings: { confirmed: true, reason: 'Bought the wrong thing', feedback: null, orderId: orderId },
  });
}

module.exports = {
  description: 'Payment refund endpoint: one-time purchases',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'rejects-an-order-that-does-not-exist',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await refund(Manager, purchaser(Manager, OWNER), '_test-order-never-existed');

        assert.equal(sent.code, 400, `An unknown order should be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /order not found/i, 'The rejection should name the order');
      },
    },

    {
      name: 'rejects-an-order-owned-by-somebody-else',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-not-yours';
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId));

        const sent = await refund(Manager, purchaser(Manager, '_test-refund-one-time-stranger'), orderId);

        assert.equal(sent.code, 400, `Another user's order should be rejected, got ${sent.code}: ${sent.body}`);
        // Not-found and not-yours read identically: an order id must not be a
        // probe for whether somebody else's purchase exists
        assert.match(`${sent.body}`, /order not found/i, 'Somebody else\'s order must not be distinguishable from a missing one');
      },
    },

    {
      name: 'rejects-a-subscription-order',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-is-a-subscription';
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId, { type: 'subscription' }));

        const sent = await refund(Manager, purchaser(Manager, OWNER), orderId);

        assert.equal(sent.code, 400, `A subscription order should be rejected here, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /one-time/i, 'The rejection should say the order is not a one-time purchase');
      },
    },

    {
      name: 'rejects-an-already-refunded-order',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-already-refunded';
        const nowUNIX = Math.floor(Date.now() / 1000);
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId, {
          requests: {
            cancellation: null,
            refund: {
              reason: 'Changed my mind',
              amount: 9.99,
              full: true,
              date: { timestamp: new Date(nowUNIX * 1000).toISOString(), timestampUNIX: nowUNIX },
            },
          },
        }));

        const sent = await refund(Manager, purchaser(Manager, OWNER), orderId);

        assert.equal(sent.code, 400, `A refunded order should be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /already been refunded/i, 'The rejection should say it was already refunded');
      },
    },

    {
      name: 'rejects-a-dashboard-refunded-order',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        // A refund issued from the processor dashboard arrives by webhook: it
        // flips unified.status to 'refunded' but writes NO requests.refund
        const orderId = '_test-order-one-time-dashboard-refunded';
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId, {
          unified: {
            product: { id: 'credits-100', name: '100 Credits' },
            status: 'refunded',
            payment: { processor: 'unknown-processor', orderId: orderId, resourceId: `_test-cs-${orderId}`, price: 9.99 },
          },
        }));

        const sent = await refund(Manager, purchaser(Manager, OWNER), orderId);

        assert.equal(sent.code, 400, `A dashboard-refunded order should be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /already been refunded/i, 'The rejection should say it was already refunded, not 500 out of the processor');
      },
    },

    {
      name: 'rejects-a-purchase-older-than-6-months',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-too-old';
        const oldUNIX = Math.floor(Date.now() / 1000) - (200 * 24 * 60 * 60);
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId, {
          metadata: { created: { timestamp: new Date(oldUNIX * 1000).toISOString(), timestampUNIX: oldUNIX } },
        }));

        const sent = await refund(Manager, purchaser(Manager, OWNER), orderId);

        assert.equal(sent.code, 400, `An old purchase should be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /older than 6 months/i, 'The refund window applies to one-time purchases too');
      },
    },

    {
      name: 'reaches-the-processor-for-a-valid-one-time-order',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-valid';
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId));

        const sent = await refund(Manager, purchaser(Manager, OWNER), orderId);

        assert.equal(sent.code, 400, `A valid order should reach the processor lookup, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /Unknown processor/i, 'A valid one-time order should get PAST every guard');
      },
    },

    {
      name: 'still-requires-confirmation',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const orderId = '_test-order-one-time-unconfirmed';
        await firestore.set(`payments-orders/${orderId}`, oneTimeOrder(orderId));

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-refund',
          user: purchaser(Manager, OWNER),
          settings: { confirmed: false, reason: 'Bought the wrong thing', feedback: null, orderId: orderId },
        });

        assert.equal(sent.code, 400, `An unconfirmed refund should be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /must be confirmed/i, 'The confirmation guard covers both paths');
      },
    },

    {
      name: 'without-an-order-id-it-is-still-the-subscription-path',
      auth: 'none',
      async run({ assert, Manager }) {
        // No orderId: a Basic user is refused for having no paid subscription,
        // exactly as before the one-time branch existed
        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-refund',
          user: purchaser(Manager, OWNER),
          settings: { confirmed: true, reason: 'Too expensive', feedback: null, orderId: null },
        });

        assert.equal(sent.code, 400, `A basic user should still be rejected, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /no paid subscription/i, 'The subscription path must be untouched');
      },
    },
  ],
};
