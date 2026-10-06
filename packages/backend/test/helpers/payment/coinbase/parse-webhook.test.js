/**
 * Test: Coinbase Commerce parseWebhook()
 * Unit tests for the Coinbase webhook provider's event categorization and routing
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * Every Coinbase Commerce event is about a CHARGE, and a charge is one payment —
 * this API has no subscription of any kind — so the whole surface is the one-time
 * category. Mirrors paypal/parse-webhook.js for consistent coverage.
 *
 * The delivery itself is authenticated by the shared `?key=` param, in the route
 * (routes/payments/webhook/post.js), the one check every provider rides: nothing
 * here verifies Coinbase's X-CC-Webhook-Signature, and the body is read for
 * IDENTIFIERS only.
 *
 * Run: npx omega test backend:helpers/payment/coinbase/parse-webhook
 */
const coinbaseProvider = require('../../../../dist/omega/routes/payments/webhook/providers/coinbase.js');
const Coinbase = require('../../../../dist/omega/libraries/payment/providers/coinbase.js');

const FIXTURE_CONFIRMED = require('../../../fixtures/coinbase/charge-confirmed.json');
const FIXTURE_PENDING = require('../../../fixtures/coinbase/charge-pending.json');
const FIXTURE_FAILED = require('../../../fixtures/coinbase/charge-failed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

function parseWebhook(body) {
  return coinbaseProvider.parseWebhook({ body: body });
}

module.exports = defineCases({
  description: 'Coinbase Commerce parseWebhook() event categorization',
  type: 'group',

  tests: [
    // ─── isSupported() ───

    {
      name: 'supports-charge-confirmed',
      async run({ expect }) {
        expect(coinbaseProvider.isSupported('charge:confirmed'), 'Should support charge:confirmed').toBeTruthy();
      },
    },

    {
      name: 'supports-charge-pending',
      async run({ expect }) {
        expect(coinbaseProvider.isSupported('charge:pending'), 'Should support charge:pending').toBeTruthy();
      },
    },

    {
      name: 'supports-charge-failed',
      async run({ expect }) {
        expect(coinbaseProvider.isSupported('charge:failed'), 'Should support charge:failed').toBeTruthy();
      },
    },

    {
      name: 'ignores-charge-created',
      async run({ expect }) {
        // charge:created is our OWN intent call answering, not a payment —
        // processing it would write an order for a checkout nobody has paid for
        expect(!coinbaseProvider.isSupported('charge:created'), 'charge:created is not a payment').toBeTruthy();
      },
    },

    {
      name: 'ignores-the-unresolved-lane',
      async run({ expect }) {
        // Underpaid/overpaid charges wait on a MERCHANT decision, which nothing
        // here specifies yet — the same rule that keeps PayPal's
        // CAPTURE.REVERSED out of its list
        expect(!coinbaseProvider.isSupported('charge:delayed'), 'charge:delayed needs its decision specified first').toBeTruthy();
        expect(!coinbaseProvider.isSupported('charge:resolved'), 'charge:resolved needs its decision specified first').toBeTruthy();
      },
    },

    {
      name: 'ignores-an-unknown-event',
      async run({ expect }) {
        expect(!coinbaseProvider.isSupported('invoice:paid'), 'An event this provider does not know is not supported').toBeTruthy();
      },
    },

    // ─── parseWebhook() ───

    {
      name: 'confirmed-charge-is-a-one-time-purchase',
      async run({ expect }) {
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        expect(parsed.eventId, 'The event id is the ENVELOPE event\'s, not the delivery attempt\'s').toBe('_test-evt-charge-confirmed');
        expect(parsed.eventType).toBe('charge:confirmed');
        expect(parsed.category, 'A crypto charge is always a one-time purchase').toBe('one-time');
        expect(parsed.resourceType).toBe('charge');
        expect(parsed.resourceId, 'The charge id is what the lookup keys on').toBe('8f783fa6-eaa3-4460-af64-cac26b183ed1');
        expect(parsed.uid, 'The uid rides in the charge metadata we set at creation').toBe('_test-coinbase-buyer');
      },
    },

    {
      name: 'the-charge-is-its-own-charge-id',
      async run({ expect }) {
        // A one-time purchase has exactly one charge, so the money event's
        // dedupe id is the charge itself (#656)
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        expect(parsed.chargeId, 'One purchase, one charge, one id').toBe(parsed.resourceId);
      },
    },

    {
      name: 'no-coinbase-event-is-ever-a-refund',
      async run({ expect }) {
        // Coinbase Commerce has no refund API and publishes no refund event —
        // returning crypto is a manual transfer that touches no record here
        for (const fixture of [FIXTURE_CONFIRMED, FIXTURE_PENDING, FIXTURE_FAILED]) {
          expect(parseWebhook(fixture).refundId, 'No delivery names a refund').toBe(null);
        }
      },
    },

    {
      name: 'pending-charge-enters-the-pipeline',
      async run({ expect }) {
        // A detected-but-unconfirmed payment still writes its order (status
        // pending) — it just detects no transition, so nothing is mailed for
        // money that has not settled
        const parsed = parseWebhook(FIXTURE_PENDING);

        expect(parsed.eventType).toBe('charge:pending');
        expect(parsed.category).toBe('one-time');
        expect(parsed.resourceId).toBe('8f783fa6-eaa3-4460-af64-cac26b183ed1');
        expect(parsed.uid).toBe('_test-coinbase-buyer');
      },
    },

    {
      name: 'failed-charge-enters-the-pipeline',
      async run({ expect }) {
        const parsed = parseWebhook(FIXTURE_FAILED);

        expect(parsed.eventType).toBe('charge:failed');
        expect(parsed.category).toBe('one-time');
        expect(parsed.resourceId).toBe('c1d2e3f4-aaaa-4bbb-8ccc-ddddeeeeffff');
        expect(parsed.uid).toBe('_test-coinbase-buyer');
      },
    },

    {
      name: 'an-unsupported-event-carries-no-category',
      async run({ expect }) {
        const parsed = parseWebhook({
          id: '_test-delivery-created',
          event: { id: '_test-evt-created', type: 'charge:created', data: { id: 'ch_x', metadata: { uid: 'u1' } } },
        });

        expect(parsed.category, 'No category means the route ignores it').toBe(null);
        expect(parsed.resourceId, 'And nothing is looked up for it').toBe(null);
      },
    },

    {
      name: 'rejects-a-payload-that-is-not-an-event',
      async run({ expect }) {
        for (const body of [null, {}, { event: {} }, { event: { id: 'e1' } }, { event: { type: 'charge:confirmed' } }]) {
          let threw = false;

          try {
            parseWebhook(body);
          } catch (e) {
            threw = true;
            expect(e.message, 'The refusal names the provider').toMatch(/Invalid Coinbase Commerce webhook payload/);
          }

          expect(threw, `Should refuse: ${JSON.stringify(body)}`).toBeTruthy();
        }
      },
    },

    {
      name: 'the-raw-body-is-what-is-stored',
      async run({ expect }) {
        // The webhook doc keeps the delivery as it arrived, and the library's
        // extractResource() has to find the charge inside THAT shape
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        expect(parsed.raw, 'The envelope is stored whole').toBe(FIXTURE_CONFIRMED);
        expect(Coinbase.extractResource(parsed.raw).id, 'And the library reads its own envelope back out of it').toBe('8f783fa6-eaa3-4460-af64-cac26b183ed1');
      },
    },
  ],
});
