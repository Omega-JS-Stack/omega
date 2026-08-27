/**
 * Test: Stripe fetchResource('charge')
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The refund of a one-time purchase carries the CHARGE that moved the money back
 * and nothing else, so the pipeline asks the library for a charge. The library
 * knew subscriptions, invoices and sessions only — 'charge' fell straight through
 * to "Unknown resource type", so every REAL Stripe one-time refund failed its
 * lookup instead of reading the charge back.
 *
 * The SDK is the one thing stubbed here: retrieving a charge needs a live Stripe
 * account. Everything under test runs for real — the branch, the expand, and the
 * metadata a charge inherits from the PaymentIntent that created it.
 *
 * Run: npx omega test backend:helpers/payment/stripe/fetch-charge
 */
const Stripe = require('../../../../src/manager/libraries/payment/providers/stripe.js');

const CHARGE_ID = 'ch_test_fetch_charge';

/** Run fn with the library's SDK replaced by a stand-in, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => sdk;

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** A stand-in SDK that records the retrieve call and answers with `charge` */
function sdkReturning(charge, calls) {
  return {
    charges: {
      retrieve: async (id, params) => {
        calls.push({ id, params });
        return charge;
      },
    },
  };
}

module.exports = {
  description: 'Stripe fetchResource() charge retrieval',
  type: 'group',

  tests: [
    {
      name: 'retrieves-the-charge',
      async run({ assert }) {
        const calls = [];
        const charge = {
          id: CHARGE_ID,
          object: 'charge',
          amount_refunded: 999,
          metadata: { uid: '_test-charge-uid', orderId: '1111-2222-3333', productId: 'credits-100' },
        };

        const resource = await withStripeSdk(sdkReturning(charge, calls), () => {
          return Stripe.fetchResource('charge', CHARGE_ID, {});
        });

        assert.equal(resource.id, CHARGE_ID, 'The charge itself is the resource');
        assert.equal(resource.metadata.orderId, '1111-2222-3333', 'The charge metadata comes through');
        assert.equal(calls.length, 1, 'The charge should be retrieved once');
        assert.equal(calls[0].id, CHARGE_ID, 'The retrieve should name the charge');
        assert.ok(calls[0].params?.expand?.includes('payment_intent'), 'The PaymentIntent behind the charge should be expanded');
      },
    },

    {
      name: 'takes-metadata-from-the-payment-intent-when-the-charge-has-none',
      async run({ assert }) {
        // Stripe copies payment_intent_data.metadata onto the charge, but a charge
        // created any other way (an API charge, an older integration) carries none —
        // the expanded intent is then the only place uid/orderId/productId live
        const charge = {
          id: CHARGE_ID,
          object: 'charge',
          metadata: {},
          payment_intent: {
            id: 'pi_test_fetch_charge',
            metadata: { uid: '_test-intent-uid', orderId: '4444-5555-6666', productId: 'credits-100' },
          },
        };

        const resource = await withStripeSdk(sdkReturning(charge, []), () => {
          return Stripe.fetchResource('charge', CHARGE_ID, {});
        });

        assert.equal(Stripe.getUid(resource), '_test-intent-uid', 'The uid should resolve from the PaymentIntent');
        assert.equal(Stripe.getOrderId(resource), '4444-5555-6666', 'The orderId should resolve from the PaymentIntent');
        assert.equal(resource.metadata.productId, 'credits-100', 'The productId should resolve from the PaymentIntent');
      },
    },

    {
      name: 'the-charge-own-metadata-wins',
      async run({ assert }) {
        const charge = {
          id: CHARGE_ID,
          object: 'charge',
          metadata: { uid: '_test-charge-uid' },
          payment_intent: { id: 'pi_test_fetch_charge', metadata: { uid: '_test-intent-uid', orderId: '7777-8888-9999' } },
        };

        const resource = await withStripeSdk(sdkReturning(charge, []), () => {
          return Stripe.fetchResource('charge', CHARGE_ID, {});
        });

        assert.equal(Stripe.getUid(resource), '_test-charge-uid', 'The charge is the newer record of the two');
        assert.equal(Stripe.getOrderId(resource), '7777-8888-9999', 'What only the intent carries still comes through');
      },
    },

    {
      name: 'a-failed-retrieve-throws-rather-than-answering-with-the-payload',
      async run({ assert }) {
        // The charge the pipeline acts on is the one Stripe answered with. A
        // retrieve that fails has no answer to give ([#506]).
        const sdk = {
          charges: {
            retrieve: async () => {
              throw new Error('Stripe API unreachable');
            },
          },
        };

        let threw = null;

        try {
          await withStripeSdk(sdk, () => Stripe.fetchResource('charge', CHARGE_ID, {}));
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed retrieve must throw');
        assert.equal(threw.notFound, false, 'An unreachable Stripe is transient, not a charge that does not exist');
        assert.match(threw.message, /could not be reached/, 'The failure says the lookup never got an answer');
      },
    },
  ],
};
