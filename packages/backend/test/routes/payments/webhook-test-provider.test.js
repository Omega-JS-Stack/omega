/**
 * Test: POST /payments/webhook — the test provider's production guard
 * ([#50](https://github.com/Omega-JS-Stack/omega/issues/50)).
 *
 * The shared `?key=OMEGA_WEBHOOK_KEY` compare is the whole verification story for
 * the webhook door. The `test` provider fabricates Stripe-shaped events, so it is
 * non-production only — the same rule the intent side enforces inside
 * `intent/providers/test.js`. The webhook providers receive only the raw req
 * (no ctx), so the guard lives at the route's dispatch layer.
 *
 * The handler is called directly with a real ctx built by Manager.RouteContext();
 * only `res` is a stand-in (the external sink), per the no-mock doctrine.
 *
 * Run: npx omega test backend:routes/payments/webhook-test-provider
 */

// Run the thunk with the environment resolving to production. getEnvironment() reads
// these vars live on every call, so swapping them is the real switch — testing wins
// over everything else, so it has to come off too.
function withProductionEnvironment(fn) {
  const original = {
    OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE,
    ENVIRONMENT: process.env.ENVIRONMENT,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  };

  delete process.env.OMEGA_TEST_MODE;
  delete process.env.TERM_PROGRAM;
  delete process.env.FUNCTIONS_EMULATOR;
  process.env.ENVIRONMENT = 'production';

  try {
    return fn();
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

// Run the thunk with Stripe's signature gate off. This suite is about the production
// guard, so its real-provider case rides the key-only path deliberately — the gate
// itself is proven in webhook-signature.test.js.
function withoutStripeSignatureGate(fn) {
  const original = process.env.STRIPE_WEBHOOK_SECRET;

  delete process.env.STRIPE_WEBHOOK_SECRET;

  try {
    return fn();
  } finally {
    if (original !== undefined) {
      process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  }
}

// A minimal express-shaped response recorder — the one external sink respond() writes to.
function recordingResponse() {
  const sent = { code: null, body: null, headers: {} };

  return {
    sent,
    headersSent: false,
    status(code) {
      sent.code = code;
      return this;
    },
    set(key, value) {
      sent.headers[key] = value;
      return this;
    },
    json(payload) {
      sent.body = payload;
      return this;
    },
    send(payload) {
      sent.body = payload;
      return this;
    },
  };
}

// Build a real ctx for a webhook request, then run the handler against it.
async function callWebhook({ Manager, query, body }) {
  const res = recordingResponse();
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: query,
    body: body,
  };
  const ctx = Manager.RouteContext({ req, res }, { functionName: 'payments-webhook' });
  const handler = require('../../../src/manager/routes/payments/webhook/post.js');

  await handler({ ctx, Manager, libraries: Manager.libraries });

  return res.sent;
}

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

module.exports = {
  description: 'Webhook test provider is non-production only',
  type: 'group',

  tests: [
    {
      name: 'test-provider-is-blocked-in-production',
      async run({ assert, Manager }) {
        const sent = await withProductionEnvironment(() => callWebhook({
          Manager,
          query: { provider: 'test', key: VALID_KEY() },
          body: { id: '_test-evt-prod-guard', type: 'customer.subscription.updated', data: { object: { id: 'sub_guard' } } },
        }));

        assert.equal(sent.code, 403, `Test provider should be forbidden in production, got ${sent.code}`);
      },
    },

    {
      name: 'real-providers-are-untouched-in-production',
      async run({ assert, Manager }) {
        const sent = await withoutStripeSignatureGate(() => withProductionEnvironment(() => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          // An unsupported event type — the handler ignores it before any Firestore write.
          body: { id: '_test-evt-prod-stripe', type: 'ping.unsupported', data: { object: {} } },
        })));

        assert.equal(sent.code, 200, `Stripe should still be accepted in production, got ${sent.code}`);
        assert.equal(sent.body.ignored, true, 'Unsupported event should be ignored');
      },
    },

    {
      name: 'test-provider-is-allowed-outside-production',
      async run({ assert, Manager, ctx }) {
        assert.equal(ctx.isProduction(), false, 'the suite must run outside production for this test');

        const sent = await callWebhook({
          Manager,
          query: { provider: 'test', key: VALID_KEY() },
          // An unsupported event type — proves dispatch got past the guard without a write.
          body: { id: '_test-evt-nonprod-guard', type: 'ping.unsupported', data: { object: {} } },
        });

        assert.equal(sent.code, 200, `Test provider should be accepted outside production, got ${sent.code}`);
        assert.equal(sent.body.ignored, true, 'Unsupported event should be ignored');
      },
    },

    {
      name: 'the-key-still-gates-before-the-provider-guard',
      async run({ assert, Manager }) {
        const sent = await withProductionEnvironment(() => callWebhook({
          Manager,
          query: { provider: 'test', key: 'wrong-key' },
          body: { id: '_test-evt-prod-badkey', type: 'customer.subscription.updated', data: { object: { id: 'sub_guard' } } },
        }));

        assert.equal(sent.code, 401, `A wrong key should still be the first rejection, got ${sent.code}`);
      },
    },
  ],
};
