/**
 * Test: the payment pipeline against REAL Stripe test-mode events
 *
 * The opt-in lane's one suite. Everything else in the payment surface proves the
 * pipeline against a fabricated event; this proves it against Stripe's — real
 * objects created in a test account, real deliveries, real signatures, forwarded
 * into the local emulator by `stripe listen`
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * It is UNREACHABLE without `npx omega test --lane=stripe-live`. The runner's
 * discovery skips this directory unless the lane's gate opened it, so no default
 * run, no CI lane and no path filter can pull it in — see
 * src/cli/commands/test-lanes/stripe-live.js for the gate.
 *
 * What only THIS lane can prove:
 *   - the signature boundary end to end. Every other webhook test either skips
 *     verification (no secret configured) or signs its own bytes; here Stripe
 *     signs and the route verifies, with the endpoint secret `stripe listen`
 *     minted for this run.
 *   - the events with no other way in. A dispute and a failed renewal cannot be
 *     produced by the checkout flow, so `stripe trigger` is the only source —
 *     and Stripe's own fixture objects are the only honest shape for them.
 *   - that the fixtures a brand's catalogue needs actually resolve.
 *     `resolvePriceId()` matches on interval and amount, so a config that has
 *     drifted from the Stripe account fails HERE rather than at a customer's
 *     checkout.
 *
 * Run: npx omega test --lane=stripe-live
 */
const PERSONA = 'basic';

module.exports = {
  description: 'Stripe LIVE lane: real test-mode events through the real webhook door',
  type: 'suite',
  timeout: 180000,

  tests: [
    {
      name: 'the-lane-is-really-open',
      async run({ assert, skip }) {
        // The gate already answered before the runner booted; this is the child's
        // half of it, so a suite that somehow got discovered without the lane
        // skips rather than firing real API calls.
        if (process.env.OMEGA_TEST_LANE !== 'stripe-live') {
          skip('the stripe-live lane is not open');
        }

        assert.ok(process.env.STRIPE_CLI_PATH, 'the lane hands down the Stripe CLI it found, which is what fires the triggers');
      },
    },

    {
      name: 'every-configured-price-resolves-in-the-stripe-account',
      async run({ assert, config, skip }) {
        if (process.env.OMEGA_TEST_LANE !== 'stripe-live') {
          skip('the stripe-live lane is not open');
        }

        // The check a brand actually needs: resolvePriceId() is what stands
        // between a config price and a checkout, and it matches on interval and
        // amount to the cent. The lane created these fixtures on the way in, so
        // a failure here means the catalogue and the account disagree.
        const StripeLib = require('../../src/manager/libraries/payment/providers/stripe.js');
        const products = (config.payment?.products || []).filter((p) => p.id !== 'basic' && p.prices && !p.archived);

        assert.ok(products.length > 0, 'the brand configures at least one paid product to resolve');

        for (const product of products) {
          const type = product.type || 'subscription';

          for (const frequency of Object.keys(product.prices)) {
            const priceId = await StripeLib.resolvePriceId(product, type, frequency);

            assert.ok(
              `${priceId}`.startsWith('price_'),
              `${product.id}/${frequency} should resolve to a Stripe price, got ${priceId}`,
            );
          }
        }
      },
    },

    {
      name: 'a-real-signed-delivery-is-accepted-and-processed',
      async run({ assert, accounts, firestore, waitFor, skip }) {
        if (process.env.OMEGA_TEST_LANE !== 'stripe-live') {
          skip('the stripe-live lane is not open');
        }

        const { trigger } = require('../../src/cli/commands/test-lanes/stripe-live.js');
        const uid = accounts[PERSONA].uid;
        const before = await firestore.collection('payments-webhooks').where('owner', '==', uid).get();
        const seen = new Set(before.docs.map((d) => d.id));

        // Stripe's own fixture subscription carries no metadata.uid, and the
        // pipeline refuses an event it cannot attribute ([#399]) — so the
        // trigger puts one on, which is exactly what a real checkout does.
        await trigger({
          stripePath: process.env.STRIPE_CLI_PATH,
          apiKey: process.env.STRIPE_SECRET_KEY_DEV || process.env.STRIPE_SECRET_KEY,
          event: 'customer.subscription.created',
          overrides: [`subscription:metadata.uid=${uid}`],
        });

        // The delivery has to travel Stripe → CLI → hosting → route → Firestore,
        // and the route only stores it AFTER verifying Stripe's signature. A doc
        // appearing at all is the proof the boundary accepted a real delivery.
        const stored = await waitFor(async () => {
          const snapshot = await firestore.collection('payments-webhooks').where('owner', '==', uid).get();
          return snapshot.docs.map((d) => d.data()).find((d) => !seen.has(d.id) && d.provider === 'stripe') || null;
        }, 90000, 1000);

        assert.equal(stored.provider, 'stripe', 'the delivery came from the real provider, not the test one');
        assert.equal(stored.event.category, 'subscription', 'and it was categorized as a subscription event');
        assert.ok(stored.raw?.id?.startsWith('evt_'), `the stored payload is Stripe's own event, got ${stored.raw?.id}`);
      },
    },

    {
      name: 'a-forged-signature-is-refused-at-the-door',
      async run({ assert, http, config, skip }) {
        if (process.env.OMEGA_TEST_LANE !== 'stripe-live') {
          skip('the stripe-live lane is not open');
        }

        // The other half of the boundary, and the half only this lane can ask:
        // with a REAL endpoint secret configured, an unsigned delivery carrying a
        // correct `?key=` must still be refused. Everywhere else this case is
        // skipped, because no secret is configured to verify against.
        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=stripe&key=${config.webhookKey}`, {
          id: `evt_test_forged_${Date.now()}`,
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_forged', object: 'subscription', status: 'canceled' } },
        });

        assert.equal(response.code, 401, `an unsigned delivery must be refused, got ${response.code}`);
      },
    },
  ],
};
