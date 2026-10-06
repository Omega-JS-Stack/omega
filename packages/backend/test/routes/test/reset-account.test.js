const uuid = require('uuid');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

/**
 * Test: test/reset-account
 *
 * The dev-only reset (#215): a journey mutates its persona, and this route puts
 * that persona back to the shape the seeder defines — user doc AND canonical
 * purchase record — for the CALLER's own account only.
 */
module.exports = defineCases({
  description: 'Reset a seeded persona back to its seed (development/testing only)',
  type: 'group',
  timeout: 60000,

  tests: [
    // Test 1: The route is authenticated — an anonymous caller cannot reset anything
    {
      name: 'requires-auth',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/test/reset-account');

        expect(response, 'An unauthenticated caller must be refused').toBeError(401);
      },
    },

    // Test 2: A mutated journey persona comes back to its seed — including the
    // order fixture the seeder itself never writes
    {
      name: 'mutated-persona-returns-to-seed',
      auth: 'journey-flows-cancel',
      async run({ http, expect, accounts, firestore, config, waitFor }) {
        const uid = accounts['journey-flows-cancel'].uid;
        const paidProduct = config.payment.products.find((product) => product.id !== 'basic' && product.prices);
        const seededOrderId = '_test-order-journey-flows-cancel';
        const strayOrderId = '_test-order-journey-flows-cancel-stray';

        // The persona starts on the paid plan with its purchase record beside it
        await firestore.set(`payments-orders/${seededOrderId}`, {
          id: seededOrderId,
          type: 'subscription',
          owner: uid,
          unified: { product: { id: paidProduct.id, name: paidProduct.name }, status: 'active' },
        });

        // Mutate it the way a cancel journey would: a cancelling subscription,
        // a second order bought along the way, and a field the seed never had
        // (the one thing a MERGE could never clean up — it proves the account
        // was rebuilt rather than patched).
        await firestore.set(`users/${uid}`, {
          subscription: { status: 'cancelled', cancellation: { pending: true }, product: { id: 'basic' } },
          _resetProbe: 'journey-residue',
        }, { merge: true });
        await firestore.set(`payments-orders/${strayOrderId}`, {
          id: strayOrderId,
          type: 'subscription',
          owner: uid,
          unified: { product: { id: paidProduct.id, name: paidProduct.name }, status: 'active' },
        });
        await firestore.delete(`payments-orders/${seededOrderId}`);

        const response = await http.as('journey-flows-cancel').post('omega/test/reset-account');

        expect(response, 'A seeded persona should be resettable').toBeSuccess();
        expect(response.data.persona, 'The route should name the persona it reset').toBe('journey-flows-cancel');
        expect(response.data.uid, 'It should reset the CALLER, not some other account').toBe(uid);
        expect(response.data.orderId, 'It should report the reseeded order fixture').toBe(seededOrderId);

        // The user doc is back to the seeded shape
        await waitFor(async () => {
          const doc = await firestore.get(`users/${uid}`);
          return doc?.subscription?.status === 'active';
        }, 15000, 250);

        const user = await firestore.get(`users/${uid}`);
        expect(user.subscription.status, 'The seeded subscription is active again').toBe('active');
        expect(user.subscription.product.id, `The persona is back on ${paidProduct.id}`).toBe(paidProduct.id);
        expect(user.subscription.cancellation.pending, 'The journey\'s pending cancellation is gone').toBe(false);
        expect(user._resetProbe, 'The journey\'s residue is gone — the account was rebuilt').toBe(undefined);
        expect(user.api?.privateKey, 'The rebuilt account carries fresh api keys').toBeTruthy();
        expect(user.flags?.signupProcessed, 'The persona is a settled user again (seeded flags merged)').toBe(true);

        // The purchase record is back, and the journey's stray order is not
        const order = await firestore.get(`payments-orders/${seededOrderId}`);
        expect(order, 'The canonical order fixture is reseeded').toBeTruthy();
        expect(order.owner, 'The order belongs to the persona').toBe(uid);
        expect(order.unified.status, 'Its status mirrors the seeded subscription').toBe('active');
        expect(order.unified.product.id, 'It names the paid plan the persona subscribes to').toBe(paidProduct.id);
        expect(await firestore.exists(`payments-orders/${strayOrderId}`), 'Orders the journey bought are cleared').toBe(false);
      },
    },

    // Test 3: An account the seeder does not define is never reset — resetting
    // deletes and recreates the account, which no real user may undergo
    {
      name: 'non-seeded-account-rejected',
      auth: 'none',
      async run({ http, expect, accounts, firestore, omega, waitFor }) {
        const admin = omega.firebase.admin;
        const domain = accounts.basic.email.split('@')[1];
        const uid = '_test-reset-outsider';
        const email = `_test.reset-outsider@${domain}`;

        // Not a seeded persona, so the pre-run wipe never deletes it — delete
        // first so the create is idempotent across runs.
        await admin.auth().deleteUser(uid).catch(() => {});
        await admin.auth().createUser({ uid, email, password: uuid.v4(), emailVerified: true });

        // auth:on-create materializes the doc and its api keys — the credential
        // this account authenticates with. A password provider is what makes it
        // a real account rather than an anonymous one on-create skips.
        const privateKey = await waitFor(async () => {
          const doc = await firestore.get(`users/${uid}`);
          return doc?.api?.privateKey;
        }, 20000, 250);

        const response = await http.withPrivateKey(privateKey).post('omega/test/reset-account');

        expect(response, 'An account with no seed definition must not be resettable').toBeError(403);

        await admin.auth().deleteUser(uid).catch(() => {});
      },
    },
  ],
});
