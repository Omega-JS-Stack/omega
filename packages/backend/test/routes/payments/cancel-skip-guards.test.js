/**
 * Test: POST /payments/cancel — `skipGuards` is a privileged request
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * `skipGuards` arrives in the request BODY, so any client can send it. It waives
 * the 24-hour subscription-age guard, which exists to stop a cancellation racing
 * a checkout that is still settling — a guard a caller must not be able to waive
 * for itself. The route honors it for an admin, or anywhere outside a real
 * deployment (the suites and the dev palette cancel seeded subscriptions minutes
 * old), and ignores it with a warning otherwise.
 *
 * The whole matrix therefore has to be driven in a PRODUCTION environment: in a
 * testing run every caller is permitted by design, so a testing-run assertion
 * would prove nothing. getEnvironment() reads the env live, so swapping it is
 * the real switch — the same technique webhook-test-provider.test.js uses.
 *
 * Both verdicts land as a 400 with DIFFERENT text: the age rejection means the
 * guard ran, and "Unknown provider" means the request got past it (the persona
 * carries a deliberately unknown provider so nothing external is ever reached).
 *
 * Run: npx omega test backend:routes/payments/cancel-skip-guards
 */
const { buildUser, callHandler, withEnvironment, PRODUCTION_ENVIRONMENT } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/cancel/post.js');

// A paid subscriber whose subscription is minutes old — the shape the age guard exists for.
function youngSubscriber(Manager, { uid, admin }) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: { admin: !!admin },
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      cancellation: { pending: false },
      payment: {
        // Deliberately unknown: getting PAST the age guard must not reach a real provider
        provider: 'unknown-provider',
        resourceId: 'sub_test_skip_guards',
        startDate: { timestamp: new Date(nowUNIX * 1000).toISOString(), timestampUNIX: nowUNIX },
      },
    },
  });
}

function cancel(Manager, user) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-cancel',
    user,
    settings: { confirmed: true, skipGuards: true, reason: null, feedback: null },
  });
}

module.exports = {
  description: 'Payment cancel endpoint: skipGuards is privileged',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'skip-guards-is-ignored-for-an-ordinary-caller',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = youngSubscriber(Manager, { uid: '_test-skip-guards-plain', admin: false });

        const sent = await withEnvironment(PRODUCTION_ENVIRONMENT, () => cancel(Manager, user));

        assert.equal(sent.code, 400, `An ordinary caller's skipGuards must not waive the age guard, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /still being set up/i, 'The age guard should be the rejection');
      },
    },

    {
      name: 'skip-guards-is-honored-for-an-admin',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = youngSubscriber(Manager, { uid: '_test-skip-guards-admin', admin: true });

        const sent = await withEnvironment(PRODUCTION_ENVIRONMENT, () => cancel(Manager, user));

        assert.equal(sent.code, 400, `An admin should reach the provider lookup, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /Unknown provider/i, 'An admin should get PAST the age guard');
      },
    },

    {
      name: 'skip-guards-is-honored-outside-production',
      auth: 'none',
      async run({ assert, Manager, ctx }) {
        assert.equal(ctx.isProduction(), false, 'the suite must run outside production for this test');

        const user = youngSubscriber(Manager, { uid: '_test-skip-guards-nonprod', admin: false });

        const sent = await cancel(Manager, user);

        assert.equal(sent.code, 400, `A non-production run should reach the provider lookup, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /Unknown provider/i, 'A non-production run should get PAST the age guard');
      },
    },

    {
      name: 'the-age-guard-still-runs-without-skip-guards',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = youngSubscriber(Manager, { uid: '_test-skip-guards-absent', admin: true });

        // An admin who never asked to bypass gets the guard like anybody else
        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-cancel',
          user,
          settings: { confirmed: true, skipGuards: false, reason: null, feedback: null },
        });

        assert.equal(sent.code, 400, `The age guard should reject, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /still being set up/i, 'The age guard should be the rejection');
      },
    },
  ],
};
