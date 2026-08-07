const uuid = require('uuid');

/**
 * Test: test/reset-account
 *
 * The dev-only reset (#215): a journey mutates its persona, and this route puts
 * that persona back to the shape the seeder defines — user doc AND canonical
 * purchase record — for the CALLER's own account only.
 */
module.exports = {
  description: 'Reset a seeded persona back to its seed (development/testing only)',
  type: 'group',
  timeout: 60000,

  tests: [
    // Test 1: The route is authenticated — an anonymous caller cannot reset anything
    {
      name: 'requires-auth',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/test/reset-account');

        assert.isError(response, 401, 'An unauthenticated caller must be refused');
      },
    },

    // Test 2: A mutated journey persona comes back to its seed — including the
    // order fixture the seeder itself never writes
    {
      name: 'mutated-persona-returns-to-seed',
      auth: 'journey-flows-cancel',
      async run({ http, assert, accounts, firestore, config, waitFor }) {
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

        const response = await http.as('journey-flows-cancel').post('backend-manager/test/reset-account');

        assert.isSuccess(response, 'A seeded persona should be resettable');
        assert.equal(response.data.persona, 'journey-flows-cancel', 'The route should name the persona it reset');
        assert.equal(response.data.uid, uid, 'It should reset the CALLER, not some other account');
        assert.equal(response.data.orderId, seededOrderId, 'It should report the reseeded order fixture');

        // The user doc is back to the seeded shape
        await waitFor(async () => {
          const doc = await firestore.get(`users/${uid}`);
          return doc?.subscription?.status === 'active';
        }, 15000, 250);

        const user = await firestore.get(`users/${uid}`);
        assert.equal(user.subscription.status, 'active', 'The seeded subscription is active again');
        assert.equal(user.subscription.product.id, paidProduct.id, `The persona is back on ${paidProduct.id}`);
        assert.equal(user.subscription.cancellation.pending, false, 'The journey\'s pending cancellation is gone');
        assert.equal(user._resetProbe, undefined, 'The journey\'s residue is gone — the account was rebuilt');
        assert.ok(user.api?.privateKey, 'The rebuilt account carries fresh api keys');
        assert.equal(user.flags?.signupProcessed, true, 'The persona is a settled user again (seeded flags merged)');

        // The purchase record is back, and the journey's stray order is not
        const order = await firestore.get(`payments-orders/${seededOrderId}`);
        assert.ok(order, 'The canonical order fixture is reseeded');
        assert.equal(order.owner, uid, 'The order belongs to the persona');
        assert.equal(order.unified.status, 'active', 'Its status mirrors the seeded subscription');
        assert.equal(order.unified.product.id, paidProduct.id, 'It names the paid plan the persona subscribes to');
        assert.equal(await firestore.exists(`payments-orders/${strayOrderId}`), false, 'Orders the journey bought are cleared');
      },
    },

    // Test 3: An account the seeder does not define is never reset — resetting
    // deletes and recreates the account, which no real user may undergo
    {
      name: 'non-seeded-account-rejected',
      auth: 'none',
      async run({ http, assert, accounts, firestore, Manager, waitFor }) {
        const admin = Manager.libraries.admin;
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

        const response = await http.withPrivateKey(privateKey).post('backend-manager/test/reset-account');

        assert.isError(response, 403, 'An account with no seed definition must not be resettable');

        await admin.auth().deleteUser(uid).catch(() => {});
      },
    },
  ],
};
