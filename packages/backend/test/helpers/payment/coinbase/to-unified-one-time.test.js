/**
 * Test: Coinbase Commerce toUnifiedOneTime()
 * Unit tests for the Coinbase library's charge → unified one-time transformation
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP.
 * Mirrors paypal/to-unified-one-time.js for consistent coverage.
 *
 * A Coinbase charge has no status FIELD: its timeline is the record, appended to
 * as the payment is detected, confirmed or expires, so the status is the last
 * entry of that list and nothing else.
 *
 * Run: npx omega test backend:helpers/payment/coinbase/to-unified-one-time
 */
const Coinbase = require('../../../../dist/manager/libraries/payment/providers/coinbase.js');

const FIXTURE_CONFIRMED = require('../../../fixtures/coinbase/charge-confirmed.json');
const FIXTURE_PENDING = require('../../../fixtures/coinbase/charge-pending.json');
const FIXTURE_FAILED = require('../../../fixtures/coinbase/charge-failed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } },
    ],
  },
};

const CHARGE_CONFIRMED = FIXTURE_CONFIRMED.event.data;
const CHARGE_PENDING = FIXTURE_PENDING.event.data;
const CHARGE_FAILED = FIXTURE_FAILED.event.data;

function toUnifiedOneTime(charge, options) {
  return Coinbase.toUnifiedOneTime(charge, { config: MOCK_CONFIG, ...options });
}

/** A charge whose timeline ends on `status` */
function chargeEndingOn(status) {
  return { id: 'ch_status_probe', timeline: [{ status: 'NEW' }, { status: status }] };
}

module.exports = defineCases({
  description: 'Coinbase Commerce toUnifiedOneTime() transformation',
  type: 'group',

  tests: [
    // ─── Status mapping (the timeline's LAST entry) ───

    {
      name: 'status-completed',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime(CHARGE_CONFIRMED).status, 'completed', 'COMPLETED → completed');
      },
    },

    {
      name: 'status-pending',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime(CHARGE_PENDING).status, 'pending', 'PENDING → pending — money detected, not settled');
      },
    },

    {
      name: 'status-expired-is-failed',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime(CHARGE_FAILED).status, 'failed', 'EXPIRED → failed');
      },
    },

    {
      name: 'status-resolved-is-completed',
      async run({ assert }) {
        // An under/overpaid charge the merchant RESOLVED is money accepted — it
        // books the way a clean COMPLETED does
        assert.equal(toUnifiedOneTime(chargeEndingOn('RESOLVED')).status, 'completed');
      },
    },

    {
      name: 'status-canceled-is-failed',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime(chargeEndingOn('CANCELED')).status, 'failed');
      },
    },

    {
      name: 'status-new-is-pending',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime(chargeEndingOn('NEW')).status, 'pending', 'A charge nobody has paid yet is pending, never failed');
      },
    },

    {
      name: 'an-unmapped-status-passes-through-lowercased',
      async run({ assert }) {
        // Inventing `failed` for a word we do not know would revoke a purchase
        // that may be perfectly fine — the siblings pass their own words through
        assert.equal(toUnifiedOneTime(chargeEndingOn('UNRESOLVED')).status, 'unresolved');
      },
    },

    {
      name: 'a-charge-with-no-timeline-is-unknown',
      async run({ assert }) {
        assert.equal(toUnifiedOneTime({ id: 'ch_bare' }).status, 'unknown', 'Absent data never claims an outcome');
      },
    },

    // ─── Identifiers and product resolution ───

    {
      name: 'resolves-the-product-from-charge-metadata',
      async run({ assert }) {
        const result = toUnifiedOneTime(CHARGE_CONFIRMED);

        assert.equal(result.product.id, 'launch-kit');
        assert.equal(result.product.name, 'Starter Library');
      },
    },

    {
      name: 'prices-from-config-not-from-the-charge',
      async run({ assert }) {
        // The catalog is the price of record, the way every sibling reads it —
        // a charge's local amount can carry a discount off it
        const result = toUnifiedOneTime(CHARGE_CONFIRMED);

        assert.equal(result.payment.price, 49.99);
      },
    },

    {
      name: 'unknown-product-degrades-without-throwing',
      async run({ assert }) {
        const result = toUnifiedOneTime({ id: 'ch_x', metadata: { productId: 'not-in-catalog' }, timeline: [{ status: 'COMPLETED' }] });

        assert.equal(result.product.id, 'not-in-catalog');
        assert.equal(result.payment.price, 0);
      },
    },

    {
      name: 'carries-the-order-and-the-resource',
      async run({ assert }) {
        const result = toUnifiedOneTime(CHARGE_CONFIRMED, { eventName: 'charge:confirmed', eventId: '_test-evt-charge-confirmed' });

        assert.equal(result.payment.provider, 'coinbase');
        assert.equal(result.payment.orderId, '_test-order-coinbase-1');
        assert.equal(result.payment.resourceId, '8f783fa6-eaa3-4460-af64-cac26b183ed1');
        assert.equal(result.payment.updatedBy.event.name, 'charge:confirmed');
        assert.equal(result.payment.updatedBy.event.id, '_test-evt-charge-confirmed');
        assert.ok(result.payment.updatedBy.date.timestampUNIX > 0, 'The write stamps when it happened');
      },
    },

    {
      name: 'getUid-and-getOrderId-read-the-charge-record',
      async run({ assert }) {
        assert.equal(Coinbase.getUid(CHARGE_CONFIRMED), '_test-coinbase-buyer');
        assert.equal(Coinbase.getOrderId(CHARGE_CONFIRMED), '_test-order-coinbase-1');

        // A charge carrying nothing answers nothing, never undefined
        assert.equal(Coinbase.getUid({}), null);
        assert.equal(Coinbase.getOrderId({}), null);
      },
    },

    {
      name: 'buildMetadata-is-the-one-shape-the-readers-expect',
      async run({ assert }) {
        const metadata = Coinbase.buildMetadata('u1', 'ord-1', 'launch-kit');

        assert.deepEqual(metadata, { uid: 'u1', orderId: 'ord-1', productId: 'launch-kit' });
        assert.equal(Coinbase.getUid({ metadata }), 'u1', 'What the intent writes is what the pipeline reads');
        assert.equal(Coinbase.getOrderId({ metadata }), 'ord-1');
      },
    },

    // ─── There is no subscription half ───

    {
      name: 'a-charge-is-never-a-subscription',
      async run({ assert }) {
        // Fabricating one would grant recurring access off a single crypto
        // payment, so the bug stops here instead
        let threw = false;

        try {
          Coinbase.toUnifiedSubscription(CHARGE_CONFIRMED, { config: MOCK_CONFIG });
        } catch (e) {
          threw = true;
          assert.match(e.message, /no subscriptions/i, 'The refusal says why');
        }

        assert.ok(threw, 'toUnifiedSubscription() must refuse');
      },
    },
  ],
});
