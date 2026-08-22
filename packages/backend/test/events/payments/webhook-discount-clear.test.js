/**
 * Test: a persisted discount belongs to the subscription it was applied to
 * ([#333](https://github.com/Omega-JS-Stack/omega/issues/333)).
 *
 * The winback claim writes `users/{uid}.subscription.discount` and nothing ever
 * cleared it. The unified webhook write carries no discount key at all, so the
 * merge PRESERVES the node forever, and a customer who churns and resubscribes
 * carried `source: 'winback'` into the new subscription, where the billing
 * card's pitch gate reads it as "already claimed" and silently never offers the
 * save again, though the backend would grant a fresh one.
 *
 * The claim stamps the subscription it discounted (`discount.resourceId`), so
 * the pipeline can tell the two apart: a webhook for a DIFFERENT subscription is
 * a new subscription, and a new subscription is a clean slate.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger runs
 * against the shared in-memory Firestore stand-in, which is what lets one test
 * start from an exact prior account state (a live claim stamped with a
 * subscription that is already gone) without minting a persona and a payment
 * history per permutation.
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');

const UID = '_test-discount-clear-uid';
const ORDER_ID = '5252-5252-5252';
const OLD_RESOURCE_ID = '_test-discount-old-sub';
const NEW_RESOURCE_ID = '_test-discount-new-sub';
const EVENT_ID = '_test-discount-evt';

/** The claimed winback discount, as the apply route persists it */
function claimedDiscount(resourceId) {
  return {
    valid: true,
    code: 'WINBACK50',
    percent: 50,
    amount: 0,
    duration: 'once',
    source: 'winback',
    resourceId: resourceId,
  };
}

/** A subscriber whose account already carries `discount`, on the subscription `resourceId` */
function subscriberSeed(discount, resourceId) {
  return {
    [`users/${UID}`]: {
      auth: { uid: UID, email: `${UID}@example.com` },
      subscription: {
        product: { id: 'premium', name: 'Premium' },
        status: 'active',
        payment: { provider: 'test', orderId: ORDER_ID, resourceId: resourceId },
        ...(discount ? { discount: discount } : {}),
      },
    },
  };
}

/** A subscription event for `resourceId`, over an account seeded with `seed` */
function runEvent({ resourceId, seed }) {
  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: resourceId,
    eventId: EVENT_ID,
    seed: seed,
  });
}

module.exports = {
  description: 'Webhook pipeline clears a discount the new subscription never claimed',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a resubscribe clears the discount claimed on the subscription that ended',

      async run() {
        const { store } = await runEvent({
          resourceId: NEW_RESOURCE_ID,
          seed: subscriberSeed(claimedDiscount(OLD_RESOURCE_ID), OLD_RESOURCE_ID),
        });

        const subscription = store.get(`users/${UID}`).subscription;

        assert.equal(subscription.payment.resourceId, NEW_RESOURCE_ID, 'the new subscription is the one on the account');
        assert.equal(subscription.discount.valid, false, 'the old claim is no longer a discount');
        assert.equal(subscription.discount.code, null, 'nothing names a coupon that ended with the old subscription');
        assert.equal(subscription.discount.percent, 0, 'and it is worth nothing');
        assert.equal(subscription.discount.amount, 0, 'in either shape');
        assert.equal(subscription.discount.duration, null);
        assert.equal(
          subscription.discount.source, null,
          'source is the pitch gate: left at winback, this customer is never offered the save again',
        );
        assert.equal(subscription.discount.resourceId, null, 'and the stamp goes with it');
      },
    },

    {
      name: 'same-subscription traffic PRESERVES the discount riding it',

      async run() {
        const discount = claimedDiscount(OLD_RESOURCE_ID);
        const { store } = await runEvent({
          resourceId: OLD_RESOURCE_ID,
          seed: subscriberSeed(discount, OLD_RESOURCE_ID),
        });

        assert.deepEqual(
          store.get(`users/${UID}`).subscription.discount, discount,
          'a renewal, a cancellation, any update to the SAME subscription leaves the saving exactly as claimed',
        );
      },
    },

    {
      name: 'an unstamped legacy discount is kept, and adopted by the subscription it is on',

      async run() {
        // A node written before the stamp existed names no subscription, and
        // nothing can prove it belongs to an older one. Keeping it is the safe
        // read: an account that resubscribed before this shipped keeps a stale
        // claim it already had, and no live discount is ever taken away from
        // someone paying a discounted price. Stamping it now is what ends that:
        // from this event on it is a normal node, and the NEXT resubscribe
        // clears it like any other.
        const legacy = claimedDiscount(OLD_RESOURCE_ID);
        delete legacy.resourceId;

        const { store } = await runEvent({
          resourceId: OLD_RESOURCE_ID,
          seed: subscriberSeed(legacy, OLD_RESOURCE_ID),
        });

        const discount = store.get(`users/${UID}`).subscription.discount;

        assert.equal(discount.valid, true, 'the discount survives');
        assert.equal(discount.code, 'WINBACK50', 'unchanged');
        assert.equal(discount.source, 'winback', 'source and all');
        assert.equal(discount.resourceId, OLD_RESOURCE_ID, 'and it now names the subscription it is riding');
      },
    },

    {
      name: 'a subscription-category event riding an invoice resource never clears the claim',

      async run() {
        // A subscription-CATEGORY event can carry a non-subscription resource
        // (Stripe charge.refunded rides an invoice; PayPal's raw-payload
        // fallback rides a sale). Its id will never match the stamp, so without
        // the resourceType gate a partial refund on a still-live discounted
        // subscription would silently clear a saving the customer still gets.
        const discount = claimedDiscount(OLD_RESOURCE_ID);
        const { store } = await runTrigger({
          uid: UID,
          orderId: ORDER_ID,
          resourceId: '_test-discount-invoice-id',
          resourceType: 'invoice',
          eventId: EVENT_ID,
          seed: subscriberSeed(discount, OLD_RESOURCE_ID),
        });

        assert.deepEqual(
          store.get(`users/${UID}`).subscription.discount, discount,
          'only a real subscription resource may judge the stamp',
        );
      },
    },

    {
      name: 'an account with no discount is left with none',

      async run() {
        const { store } = await runEvent({
          resourceId: NEW_RESOURCE_ID,
          seed: subscriberSeed(null, OLD_RESOURCE_ID),
        });

        assert.equal(
          store.get(`users/${UID}`).subscription.discount, undefined,
          'the pipeline never writes a discount node onto an account that has none',
        );
      },
    },
  ],
};
