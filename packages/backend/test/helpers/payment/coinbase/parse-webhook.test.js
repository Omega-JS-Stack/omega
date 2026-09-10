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
const coinbaseProvider = require('../../../../dist/manager/routes/payments/webhook/providers/coinbase.js');
const Coinbase = require('../../../../dist/manager/libraries/payment/providers/coinbase.js');

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
      async run({ assert }) {
        assert.ok(coinbaseProvider.isSupported('charge:confirmed'), 'Should support charge:confirmed');
      },
    },

    {
      name: 'supports-charge-pending',
      async run({ assert }) {
        assert.ok(coinbaseProvider.isSupported('charge:pending'), 'Should support charge:pending');
      },
    },

    {
      name: 'supports-charge-failed',
      async run({ assert }) {
        assert.ok(coinbaseProvider.isSupported('charge:failed'), 'Should support charge:failed');
      },
    },

    {
      name: 'ignores-charge-created',
      async run({ assert }) {
        // charge:created is our OWN intent call answering, not a payment —
        // processing it would write an order for a checkout nobody has paid for
        assert.ok(!coinbaseProvider.isSupported('charge:created'), 'charge:created is not a payment');
      },
    },

    {
      name: 'ignores-the-unresolved-lane',
      async run({ assert }) {
        // Underpaid/overpaid charges wait on a MERCHANT decision, which nothing
        // here specifies yet — the same rule that keeps PayPal's
        // CAPTURE.REVERSED out of its list
        assert.ok(!coinbaseProvider.isSupported('charge:delayed'), 'charge:delayed needs its decision specified first');
        assert.ok(!coinbaseProvider.isSupported('charge:resolved'), 'charge:resolved needs its decision specified first');
      },
    },

    {
      name: 'ignores-an-unknown-event',
      async run({ assert }) {
        assert.ok(!coinbaseProvider.isSupported('invoice:paid'), 'An event this provider does not know is not supported');
      },
    },

    // ─── parseWebhook() ───

    {
      name: 'confirmed-charge-is-a-one-time-purchase',
      async run({ assert }) {
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        assert.equal(parsed.eventId, '_test-evt-charge-confirmed', 'The event id is the ENVELOPE event\'s, not the delivery attempt\'s');
        assert.equal(parsed.eventType, 'charge:confirmed');
        assert.equal(parsed.category, 'one-time', 'A crypto charge is always a one-time purchase');
        assert.equal(parsed.resourceType, 'charge');
        assert.equal(parsed.resourceId, '8f783fa6-eaa3-4460-af64-cac26b183ed1', 'The charge id is what the lookup keys on');
        assert.equal(parsed.uid, '_test-coinbase-buyer', 'The uid rides in the charge metadata we set at creation');
      },
    },

    {
      name: 'the-charge-is-its-own-charge-id',
      async run({ assert }) {
        // A one-time purchase has exactly one charge, so the money event's
        // dedupe id is the charge itself (#656)
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        assert.equal(parsed.chargeId, parsed.resourceId, 'One purchase, one charge, one id');
      },
    },

    {
      name: 'no-coinbase-event-is-ever-a-refund',
      async run({ assert }) {
        // Coinbase Commerce has no refund API and publishes no refund event —
        // returning crypto is a manual transfer that touches no record here
        for (const fixture of [FIXTURE_CONFIRMED, FIXTURE_PENDING, FIXTURE_FAILED]) {
          assert.equal(parseWebhook(fixture).refundId, null, 'No delivery names a refund');
        }
      },
    },

    {
      name: 'pending-charge-enters-the-pipeline',
      async run({ assert }) {
        // A detected-but-unconfirmed payment still writes its order (status
        // pending) — it just detects no transition, so nothing is mailed for
        // money that has not settled
        const parsed = parseWebhook(FIXTURE_PENDING);

        assert.equal(parsed.eventType, 'charge:pending');
        assert.equal(parsed.category, 'one-time');
        assert.equal(parsed.resourceId, '8f783fa6-eaa3-4460-af64-cac26b183ed1');
        assert.equal(parsed.uid, '_test-coinbase-buyer');
      },
    },

    {
      name: 'failed-charge-enters-the-pipeline',
      async run({ assert }) {
        const parsed = parseWebhook(FIXTURE_FAILED);

        assert.equal(parsed.eventType, 'charge:failed');
        assert.equal(parsed.category, 'one-time');
        assert.equal(parsed.resourceId, 'c1d2e3f4-aaaa-4bbb-8ccc-ddddeeeeffff');
        assert.equal(parsed.uid, '_test-coinbase-buyer');
      },
    },

    {
      name: 'an-unsupported-event-carries-no-category',
      async run({ assert }) {
        const parsed = parseWebhook({
          id: '_test-delivery-created',
          event: { id: '_test-evt-created', type: 'charge:created', data: { id: 'ch_x', metadata: { uid: 'u1' } } },
        });

        assert.equal(parsed.category, null, 'No category means the route ignores it');
        assert.equal(parsed.resourceId, null, 'And nothing is looked up for it');
      },
    },

    {
      name: 'rejects-a-payload-that-is-not-an-event',
      async run({ assert }) {
        for (const body of [null, {}, { event: {} }, { event: { id: 'e1' } }, { event: { type: 'charge:confirmed' } }]) {
          let threw = false;

          try {
            parseWebhook(body);
          } catch (e) {
            threw = true;
            assert.match(e.message, /Invalid Coinbase Commerce webhook payload/, 'The refusal names the provider');
          }

          assert.ok(threw, `Should refuse: ${JSON.stringify(body)}`);
        }
      },
    },

    {
      name: 'the-raw-body-is-what-is-stored',
      async run({ assert }) {
        // The webhook doc keeps the delivery as it arrived, and the library's
        // extractResource() has to find the charge inside THAT shape
        const parsed = parseWebhook(FIXTURE_CONFIRMED);

        assert.equal(parsed.raw, FIXTURE_CONFIRMED, 'The envelope is stored whole');
        assert.equal(
          Coinbase.extractResource(parsed.raw).id, '8f783fa6-eaa3-4460-af64-cac26b183ed1',
          'And the library reads its own envelope back out of it',
        );
      },
    },
  ],
});
