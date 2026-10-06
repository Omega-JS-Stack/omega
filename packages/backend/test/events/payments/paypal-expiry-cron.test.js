/**
 * Test: the daily PayPal pending-cancellation expiry cron
 *
 * PayPal cancels immediately on its side and fires no webhook at period end, so this
 * cron is the ONLY thing that ends a PayPal subscriber's paid term. It used to write
 * the user doc alone — the `payments-orders` record stayed active forever, and that
 * record's `unified` mirror is what the transition handlers and the UI read ([#221]).
 *
 * It also merged a whole subscription map read from a batch snapshot, so a webhook that
 * landed between the read and the write was overwritten with the pre-read state. The
 * cron now takes the same staleness discipline the webhook trigger takes: anything
 * stamped after this run's read wins, and the cron stands down.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const EXPIRE_UID = '_test-paypal-expire';
const RACE_UID = '_test-paypal-expire-race';

const EXPIRE_ORDER = '_test-order-paypal-expire';
const RACE_ORDER = '_test-order-paypal-expire-race';

module.exports = defineCases({
  description: 'PayPal expiry cron: the order flips with the subscription, and a newer webhook wins',
  type: 'suite',
  timeout: 180000,

  tests: [
    {
      name: 'seed-pending-cancellations',
      async run({ firestore, expect, state, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);

        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        state.paidProductId = paidProduct.id;

        const nowUNIX = Math.floor(Date.now() / 1000);
        state.expiredUNIX = nowUNIX - DAY;

        // The candidate the cron must expire
        await seed(firestore, {
          uid: EXPIRE_UID,
          orderId: EXPIRE_ORDER,
          productId: paidProduct.id,
          expiresUNIX: state.expiredUNIX,
          orderUpdatedUNIX: nowUNIX - HOUR,
        });

        // The race: the order carries a stamp from AFTER this run's read — which is what
        // a webhook landing between the cron's read and its write looks like
        state.raceUpdatedUNIX = nowUNIX + HOUR;
        await seed(firestore, {
          uid: RACE_UID,
          orderId: RACE_ORDER,
          productId: paidProduct.id,
          expiresUNIX: state.expiredUNIX,
          orderUpdatedUNIX: state.raceUpdatedUNIX,
        });

        const seeded = await firestore.get(`payments-orders/${EXPIRE_ORDER}`);
        expect(seeded.unified.status, 'The order starts alive alongside the subscription').toBe('active');
      },
    },

    {
      name: 'the-order-flips-with-the-subscription',
      timeout: 150000,
      async run({ firestore, expect, waitFor, pubsub, state }) {
        await pubsub.trigger('omega_cronDaily');

        await waitFor(async () => {
          const doc = await firestore.get(`users/${EXPIRE_UID}`);
          return doc?.subscription?.status === 'cancelled';
        }, 120000, 1000);

        const user = await firestore.get(`users/${EXPIRE_UID}`);
        const order = await firestore.get(`payments-orders/${EXPIRE_ORDER}`);

        expect(user.subscription.status, 'The paid term ended').toBe('cancelled');
        expect(user.subscription.cancellation.pending, 'Nothing is left pending').toBe(false);

        expect(order.unified.status, 'The order doc flips WITH the subscription — it is what handlers and the UI read').toBe('cancelled');
        expect(order.unified.cancellation.pending, 'The order mirror clears the pending flag too').toBe(false);
        expect(order.metadata.updated.timestampUNIX > state.expiredUNIX, 'The order carries a fresh update stamp, so the NEXT webhook can tell it is newer').toBeTruthy();

        // The write is the cron's delta, not a whole map: everything else on the order
        // survives untouched
        expect(order.unified.product.id, 'The order still names its product').toBe(state.paidProductId);
        expect(order.unified.cancellation.date.timestampUNIX, 'The cancellation date the user requested survives').toBe(state.expiredUNIX);
        expect(order.owner, 'The order still belongs to its owner').toBe(EXPIRE_UID);
      },
    },

    {
      name: 'a-newer-webhook-stamp-wins-and-the-cron-stands-down',
      async run({ firestore, expect, state }) {
        const user = await firestore.get(`users/${RACE_UID}`);
        const order = await firestore.get(`payments-orders/${RACE_ORDER}`);

        expect(user.subscription.status, 'A subscription whose order was written after the read is left alone').toBe('active');
        expect(user.subscription.cancellation.pending, 'Its pending flag is untouched').toBe(true);
        expect(order.unified.status, 'The order the newer write owns is untouched').toBe('active');
        expect(order.metadata.updated.timestampUNIX, 'The newer stamp survives — the cron did not overwrite it with its own').toBe(state.raceUpdatedUNIX);
      },
    },
  ],
});

/**
 * Seed a PayPal subscriber whose pending cancellation has run out its paid term,
 * plus the purchase record that mirrors it
 */
async function seed(firestore, { uid, orderId, productId, expiresUNIX, orderUpdatedUNIX }) {
  await firestore.delete(`users/${uid}`);
  await firestore.delete(`payments-orders/${orderId}`);

  await firestore.set(`users/${uid}`, {
    subscription: {
      product: { id: productId, name: productId },
      status: 'active',
      expires: stamp(expiresUNIX),
      trial: { claimed: false, expires: stamp(0) },
      cancellation: { pending: true, date: stamp(expiresUNIX) },
      payment: { provider: 'paypal', orderId: orderId, resourceId: `I-${uid}`, frequency: 'monthly' },
    },
  });

  await firestore.set(`payments-orders/${orderId}`, {
    id: orderId,
    type: 'subscription',
    owner: uid,
    productId: productId,
    provider: 'paypal',
    resourceId: `I-${uid}`,
    unified: {
      product: { id: productId, name: productId },
      status: 'active',
      expires: stamp(expiresUNIX),
      cancellation: { pending: true, date: stamp(expiresUNIX) },
      payment: { provider: 'paypal', orderId: orderId, resourceId: `I-${uid}`, frequency: 'monthly' },
    },
    metadata: {
      created: stamp(orderUpdatedUNIX - 30 * DAY),
      updated: stamp(orderUpdatedUNIX),
    },
  });
}

/**
 * A `$timestamp` pair from a UNIX second
 */
function stamp(unix) {
  return { timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix };
}
