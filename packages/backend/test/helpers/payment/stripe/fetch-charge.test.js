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
const Stripe = require('../../../../dist/omega/libraries/payment/providers/stripe.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

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

module.exports = defineCases({
  description: 'Stripe fetchResource() charge retrieval',
  type: 'group',

  tests: [
    {
      name: 'retrieves-the-charge',
      async run({ expect }) {
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

        expect(resource.id, 'The charge itself is the resource').toBe(CHARGE_ID);
        expect(resource.metadata.orderId, 'The charge metadata comes through').toBe('1111-2222-3333');
        expect(calls.length, 'The charge should be retrieved once').toBe(1);
        expect(calls[0].id, 'The retrieve should name the charge').toBe(CHARGE_ID);
        expect(calls[0].params?.expand?.includes('payment_intent'), 'The PaymentIntent behind the charge should be expanded').toBeTruthy();
      },
    },

    {
      name: 'takes-metadata-from-the-payment-intent-when-the-charge-has-none',
      async run({ expect }) {
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

        expect(Stripe.getUid(resource), 'The uid should resolve from the PaymentIntent').toBe('_test-intent-uid');
        expect(Stripe.getOrderId(resource), 'The orderId should resolve from the PaymentIntent').toBe('4444-5555-6666');
        expect(resource.metadata.productId, 'The productId should resolve from the PaymentIntent').toBe('credits-100');
      },
    },

    {
      name: 'the-charge-own-metadata-wins',
      async run({ expect }) {
        const charge = {
          id: CHARGE_ID,
          object: 'charge',
          metadata: { uid: '_test-charge-uid' },
          payment_intent: { id: 'pi_test_fetch_charge', metadata: { uid: '_test-intent-uid', orderId: '7777-8888-9999' } },
        };

        const resource = await withStripeSdk(sdkReturning(charge, []), () => {
          return Stripe.fetchResource('charge', CHARGE_ID, {});
        });

        expect(Stripe.getUid(resource), 'The charge is the newer record of the two').toBe('_test-charge-uid');
        expect(Stripe.getOrderId(resource), 'What only the intent carries still comes through').toBe('7777-8888-9999');
      },
    },

    {
      name: 'a-failed-retrieve-throws-rather-than-answering-with-the-payload',
      async run({ expect }) {
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

        expect(threw, 'A failed retrieve must throw').toBeTruthy();
        expect(threw.notFound, 'An unreachable Stripe is transient, not a charge that does not exist').toBe(false);
        expect(threw.message, 'The failure says the lookup never got an answer').toMatch(/could not be reached/);
      },
    },
  ],
});
