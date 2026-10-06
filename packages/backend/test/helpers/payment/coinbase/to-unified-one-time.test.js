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
const Coinbase = require('../../../../dist/omega/libraries/payment/providers/coinbase.js');

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
      async run({ expect }) {
        expect(toUnifiedOneTime(CHARGE_CONFIRMED).status, 'COMPLETED → completed').toBe('completed');
      },
    },

    {
      name: 'status-pending',
      async run({ expect }) {
        expect(toUnifiedOneTime(CHARGE_PENDING).status, 'PENDING → pending — money detected, not settled').toBe('pending');
      },
    },

    {
      name: 'status-expired-is-failed',
      async run({ expect }) {
        expect(toUnifiedOneTime(CHARGE_FAILED).status, 'EXPIRED → failed').toBe('failed');
      },
    },

    {
      name: 'status-resolved-is-completed',
      async run({ expect }) {
        // An under/overpaid charge the merchant RESOLVED is money accepted — it
        // books the way a clean COMPLETED does
        expect(toUnifiedOneTime(chargeEndingOn('RESOLVED')).status).toBe('completed');
      },
    },

    {
      name: 'status-canceled-is-failed',
      async run({ expect }) {
        expect(toUnifiedOneTime(chargeEndingOn('CANCELED')).status).toBe('failed');
      },
    },

    {
      name: 'status-new-is-pending',
      async run({ expect }) {
        expect(toUnifiedOneTime(chargeEndingOn('NEW')).status, 'A charge nobody has paid yet is pending, never failed').toBe('pending');
      },
    },

    {
      name: 'an-unmapped-status-passes-through-lowercased',
      async run({ expect }) {
        // Inventing `failed` for a word we do not know would revoke a purchase
        // that may be perfectly fine — the siblings pass their own words through
        expect(toUnifiedOneTime(chargeEndingOn('UNRESOLVED')).status).toBe('unresolved');
      },
    },

    {
      name: 'a-charge-with-no-timeline-is-unknown',
      async run({ expect }) {
        expect(toUnifiedOneTime({ id: 'ch_bare' }).status, 'Absent data never claims an outcome').toBe('unknown');
      },
    },

    // ─── Identifiers and product resolution ───

    {
      name: 'resolves-the-product-from-charge-metadata',
      async run({ expect }) {
        const result = toUnifiedOneTime(CHARGE_CONFIRMED);

        expect(result.product.id).toBe('launch-kit');
        expect(result.product.name).toBe('Starter Library');
      },
    },

    {
      name: 'prices-from-config-not-from-the-charge',
      async run({ expect }) {
        // The catalog is the price of record, the way every sibling reads it —
        // a charge's local amount can carry a discount off it
        const result = toUnifiedOneTime(CHARGE_CONFIRMED);

        expect(result.payment.price).toBe(49.99);
      },
    },

    {
      name: 'unknown-product-degrades-without-throwing',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'ch_x', metadata: { productId: 'not-in-catalog' }, timeline: [{ status: 'COMPLETED' }] });

        expect(result.product.id).toBe('not-in-catalog');
        expect(result.payment.price).toBe(0);
      },
    },

    {
      name: 'carries-the-order-and-the-resource',
      async run({ expect }) {
        const result = toUnifiedOneTime(CHARGE_CONFIRMED, { eventName: 'charge:confirmed', eventId: '_test-evt-charge-confirmed' });

        expect(result.payment.provider).toBe('coinbase');
        expect(result.payment.orderId).toBe('_test-order-coinbase-1');
        expect(result.payment.resourceId).toBe('8f783fa6-eaa3-4460-af64-cac26b183ed1');
        expect(result.payment.updatedBy.event.name).toBe('charge:confirmed');
        expect(result.payment.updatedBy.event.id).toBe('_test-evt-charge-confirmed');
        expect(result.payment.updatedBy.date.timestampUNIX > 0, 'The write stamps when it happened').toBeTruthy();
      },
    },

    {
      name: 'getUid-and-getOrderId-read-the-charge-record',
      async run({ expect }) {
        expect(Coinbase.getUid(CHARGE_CONFIRMED)).toBe('_test-coinbase-buyer');
        expect(Coinbase.getOrderId(CHARGE_CONFIRMED)).toBe('_test-order-coinbase-1');

        // A charge carrying nothing answers nothing, never undefined
        expect(Coinbase.getUid({})).toBe(null);
        expect(Coinbase.getOrderId({})).toBe(null);
      },
    },

    {
      name: 'buildMetadata-is-the-one-shape-the-readers-expect',
      async run({ expect }) {
        const metadata = Coinbase.buildMetadata('u1', 'ord-1', 'launch-kit');

        expect(metadata).toEqual({ uid: 'u1', orderId: 'ord-1', productId: 'launch-kit' });
        expect(Coinbase.getUid({ metadata }), 'What the intent writes is what the pipeline reads').toBe('u1');
        expect(Coinbase.getOrderId({ metadata })).toBe('ord-1');
      },
    },

    // ─── There is no subscription half ───

    {
      name: 'a-charge-is-never-a-subscription',
      async run({ expect }) {
        // Fabricating one would grant recurring access off a single crypto
        // payment, so the bug stops here instead
        let threw = false;

        try {
          Coinbase.toUnifiedSubscription(CHARGE_CONFIRMED, { config: MOCK_CONFIG });
        } catch (e) {
          threw = true;
          expect(e.message, 'The refusal says why').toMatch(/no subscriptions/i);
        }

        expect(threw, 'toUnifiedSubscription() must refuse').toBeTruthy();
      },
    },
  ],
});
