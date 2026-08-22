/**
 * Test: POST /payments/uncancel — guards and the per-provider capability gate
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * Uncancel is an OWNED route next to cancel, cross-provider and capability-gated:
 * a provider that can resume a subscription EXPORTS `uncancel`, one that cannot
 * simply lacks the export, and the route refuses BEFORE dispatch rather than
 * letting the caller discover it as a provider error.
 *
 * Two layers:
 *  - the route, called directly against a real ctx (the _route-harness technique),
 *    so one test can choose a provider and a subscription shape without minting a
 *    persona per permutation;
 *  - the provider modules themselves, asserted as a capability TABLE — the export
 *    list IS the contract the route reads.
 *
 * The full end-to-end pipeline run lives in
 * test/events/payments/journey-payments-uncancel.test.js.
 *
 * Run: npx omega test framework:routes/payments/uncancel
 */
const { buildUser, callHandler, recordingResponse, withEnvironment } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/uncancel/post.js');

const PROVIDERS = ['stripe', 'chargebee', 'paypal', 'test'];

function providerModule(name) {
  return require(`../../../src/manager/routes/payments/uncancel/providers/${name}.js`);
}

// A subscriber whose cancellation is scheduled — the one state uncancel accepts.
function pendingSubscriber(Manager, { uid, provider, status, pending, productId, resourceId }) {
  const lastYearUNIX = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: {
      product: { id: productId === undefined ? 'premium' : productId, name: 'Premium' },
      status: status || 'active',
      cancellation: { pending: pending === undefined ? true : pending },
      payment: {
        provider: provider === undefined ? 'test' : provider,
        resourceId: resourceId === undefined ? 'sub_test_uncancel_guard' : resourceId,
        frequency: 'monthly',
        startDate: { timestamp: new Date(lastYearUNIX * 1000).toISOString(), timestampUNIX: lastYearUNIX },
      },
    },
  });
}

function uncancel(Manager, user, settings) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-uncancel',
    user,
    settings: { confirmed: true, ...(settings || {}) },
  });
}

/**
 * The same direct call, with the `omega-properties` header captured.
 *
 * The shared harness's recorder implements express's `res.set()`; the assistant
 * writes that header through `res.header()`/`res.get()`, so a test that needs to
 * READ the structured half of a response lends the SAME recorder those two
 * methods rather than inventing a second response shape.
 *
 * @returns {Promise<{ sent: object, properties: object|null }>}
 */
async function uncancelReadingProperties(Manager, user) {
  const res = recordingResponse();
  const headers = {};

  res.header = (key, value) => {
    headers[key] = value;
    return res;
  };
  res.get = (key) => headers[key];

  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, query: {}, body: {} };
  const ctx = Manager.RouteContext({ req, res }, { functionName: 'payments-uncancel' });

  await handler({ ctx, Manager, user, settings: { confirmed: true }, libraries: Manager.libraries });

  return {
    sent: res.sent,
    properties: headers['omega-properties'] ? JSON.parse(headers['omega-properties']) : null,
  };
}

module.exports = {
  description: 'Payment uncancel endpoint: guards + provider capability gate',
  type: 'group',
  timeout: 15000,

  tests: [
    // ─── the wire guards ───

    {
      name: 'rejects-unauthenticated',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/uncancel', {
          confirmed: true,
        });

        assert.isError(response, 401, 'Should reject unauthenticated request');
      },
    },

    {
      name: 'rejects-missing-confirmed',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/uncancel', {});

        assert.isError(response, 400, 'Should reject a request that never confirmed');
      },
    },

    // ─── the subscription-state guards ───

    {
      name: 'rejects-unconfirmed',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-unconfirmed' });

        const sent = await uncancel(Manager, user, { confirmed: false });

        assert.equal(sent.code, 400, `An unconfirmed uncancel must be refused, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-basic-user',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-basic', productId: 'basic' });

        const sent = await uncancel(Manager, user);

        assert.equal(sent.code, 400, `A free user has no cancellation to undo, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-no-pending-cancellation',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-not-pending', pending: false });

        const sent = await uncancel(Manager, user);

        assert.equal(sent.code, 400, `Nothing is scheduled, so there is nothing to resume, got ${sent.code}`);
        assert.match(`${sent.body}`, /not scheduled to cancel/i, `Expected the no-pending-cancellation message, got: ${sent.body}`);
      },
    },

    {
      name: 'rejects-a-subscription-that-is-no-longer-active',
      auth: 'none',
      async run({ assert, Manager }) {
        // A suspended (or fully cancelled) subscription cannot be resumed by
        // clearing a scheduled cancellation — the term is already broken.
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-suspended', status: 'suspended' });

        const sent = await uncancel(Manager, user);

        assert.equal(sent.code, 400, `Only an ACTIVE subscription can be resumed, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-missing-payment-details',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-no-provider', provider: null, resourceId: null });

        const sent = await uncancel(Manager, user);

        assert.equal(sent.code, 400, `Without a provider there is nothing to call, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-unknown-provider',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-unknown', provider: 'unknown-provider' });

        const sent = await uncancel(Manager, user);

        assert.equal(sent.code, 400, `An unknown provider must be refused, got ${sent.code}`);
      },
    },

    // ─── the capability gate ───

    {
      name: 'paypal-is-gated-before-any-api-call',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-paypal', provider: 'paypal', resourceId: 'I-TESTUNCANCEL' });

        // PayPal's credentials are stripped: ANY attempt to reach PayPal would
        // throw inside the client and surface as a 500. A 400 is therefore proof
        // the route refused BEFORE dispatch — no network dependency at all.
        const sent = await withEnvironment({ PAYPAL_CLIENT_ID: null, PAYPAL_CLIENT_SECRET: null }, () => uncancel(Manager, user));

        assert.equal(sent.code, 400, `An unsupported operation is a client fault, not an outage, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.match(`${sent.body}`, /billing portal/i, `The refusal should point at the billing portal, got: ${sent.body}`);
        assert.ok(!/paypal api/i.test(`${sent.body}`), `No PayPal call may be attempted, got: ${sent.body}`);
      },
    },

    {
      name: 'the-gate-carries-a-structured-code',
      auth: 'none',
      async run({ assert, Manager }) {
        // The client branches on the code, not on the sentence — so the code
        // rides the response's own properties, where every 4xx carries its
        // machine-readable half.
        const user = pendingSubscriber(Manager, { uid: '_test-uncancel-paypal-code', provider: 'paypal', resourceId: 'I-TESTUNCANCEL' });

        const { sent, properties } = await withEnvironment(
          { PAYPAL_CLIENT_ID: null, PAYPAL_CLIENT_SECRET: null },
          () => uncancelReadingProperties(Manager, user),
        );

        assert.equal(sent.code, 400, `Expected the capability gate, got ${sent.code}`);
        assert.equal(properties?.additional?.code, 'not-supported-by-provider', `Expected a branchable code on omega-properties, got: ${JSON.stringify(properties?.additional)}`);
      },
    },

    // ─── the capability TABLE: the export list IS the contract ───

    {
      name: 'every-provider-module-loads',
      auth: 'none',
      async run({ assert }) {
        PROVIDERS.forEach((name) => {
          assert.ok(providerModule(name), `routes/payments/uncancel/providers/${name}.js should exist so the route can ask it about the operation`);
        });
      },
    },

    {
      name: 'stripe-chargebee-and-test-support-uncancel',
      auth: 'none',
      async run({ assert }) {
        ['stripe', 'chargebee', 'test'].forEach((name) => {
          assert.equal(typeof providerModule(name).uncancel, 'function', `${name} should export uncancel()`);
        });
      },
    },

    {
      name: 'paypal-ships-no-uncancel-export',
      auth: 'none',
      async run({ assert }) {
        // PayPal's API cannot resume a cancelled subscription — activate only
        // works on a SUSPENDED one. The missing export is the whole gate.
        assert.equal(typeof providerModule('paypal').uncancel, 'undefined', 'paypal must not export uncancel() — its API cannot resume a cancelled subscription');
      },
    },
  ],
};
