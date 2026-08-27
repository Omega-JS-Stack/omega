/**
 * Test: POST /payments/cancel — only "already gone" force-cancels
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A suspended subscriber whose provider record no longer exists gets their
 * subscription reset directly, so they can re-subscribe. That write used to fire
 * on ANY provider error: a network blip, an expired key, a rate limit — each
 * one silently downgraded a paying user to Basic and reported success. Now the
 * force-cancel answers to one classification only, and everything else returns
 * the failure with NOTHING written.
 *
 * Two layers, each proving what it can:
 *  - the classifier against REAL SDK error objects (the Stripe SDK's own error
 *    classes; the exact strings the PayPal and Chargebee clients in this repo
 *    throw) — the only place a live 404 can be represented offline;
 *  - the route against a genuine transient failure: a `stripe` subscription with
 *    no STRIPE_SECRET_KEY configured, which is exactly the misconfiguration that
 *    used to fake a cancellation.
 *
 * Run: npx omega test backend:routes/payments/cancel-provider-errors
 */
const Stripe = require('stripe');
const { buildUser, callHandler, withEnvironment } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/cancel/post.js');
const isAlreadyGone = require('../../../src/manager/libraries/payment/provider-errors.js');

// A subscriber on a real provider, old enough to clear the age guard.
function subscriber(Manager, { uid, status, provider }) {
  const lastYearUNIX = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: status,
      cancellation: { pending: false },
      payment: {
        provider: provider,
        resourceId: 'sub_test_provider_error',
        startDate: { timestamp: new Date(lastYearUNIX * 1000).toISOString(), timestampUNIX: lastYearUNIX },
      },
    },
  });
}

// Cancel with Stripe unconfigured — StripeLib.init() throws, the transient failure
// closest to a real outage that can be produced offline.
function cancelWithoutStripeKey(Manager, user) {
  return withEnvironment({ STRIPE_SECRET_KEY: null }, () => callHandler({
    Manager,
    handler,
    functionName: 'payments-cancel',
    user,
    settings: { confirmed: true, skipGuards: false, reason: null, feedback: null },
  }));
}

module.exports = {
  description: 'Payment cancel endpoint: provider error classification',
  type: 'group',
  timeout: 15000,

  tests: [
    // ─── the route ───

    {
      name: 'a-transient-failure-on-a-suspended-subscription-writes-nothing',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const uid = '_test-cancel-transient-suspended';
        const user = subscriber(Manager, { uid, status: 'suspended', provider: 'stripe' });

        assert.equal(await firestore.exists(`users/${uid}`), false, 'the case starts with no user doc to overwrite');

        const sent = await cancelWithoutStripeKey(Manager, user);

        assert.equal(sent.code, 500, `A transient failure must reach the caller, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(await firestore.exists(`users/${uid}`), false, 'A transient failure must never write a cancelled subscription');
      },
    },

    {
      name: 'a-transient-failure-on-an-active-subscription-writes-nothing',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const uid = '_test-cancel-transient-active';
        const user = subscriber(Manager, { uid, status: 'active', provider: 'stripe' });

        const sent = await cancelWithoutStripeKey(Manager, user);

        assert.equal(sent.code, 500, `A transient failure must reach the caller, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(await firestore.exists(`users/${uid}`), false, 'A transient failure must never write a cancelled subscription');
      },
    },

    {
      name: 'the-failure-response-carries-no-sdk-detail',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = subscriber(Manager, { uid: '_test-cancel-neutral-message', status: 'active', provider: 'stripe' });

        const sent = await cancelWithoutStripeKey(Manager, user);

        assert.equal(sent.code, 500, `Expected the provider failure, got ${sent.code}`);
        assert.ok(!/STRIPE_SECRET_KEY/.test(`${sent.body}`), `The SDK detail must stay in the logs, got: ${sent.body}`);
        assert.match(`${sent.body}`, /could not cancel your subscription/i, 'The client should get the neutral message');
      },
    },

    // ─── the classifier: already gone ───

    {
      name: 'classifies-a-stripe-missing-resource-as-gone',
      auth: 'none',
      async run({ assert }) {
        // The SDK's own error class, generated from the payload Stripe returns
        // for a subscription that does not exist.
        const error = Stripe.errors.StripeInvalidRequestError.generate({
          type: 'invalid_request_error',
          code: 'resource_missing',
          statusCode: 404,
          message: "No such subscription: 'sub_test_provider_error'",
        });

        assert.equal(isAlreadyGone(error), true, 'Stripe resource_missing means the subscription is gone');
      },
    },

    {
      name: 'classifies-a-chargebee-404-as-gone',
      auth: 'none',
      async run({ assert }) {
        // The shape libraries/payment/providers/chargebee.js throws
        const error = new Error('Chargebee API 404: Sorry, we couldn\'t find that resource');
        error.statusCode = 404;

        assert.equal(isAlreadyGone(error), true, 'A Chargebee 404 means the subscription is gone');
      },
    },

    {
      name: 'classifies-a-paypal-404-as-gone',
      auth: 'none',
      async run({ assert }) {
        // The shape libraries/payment/providers/paypal.js throws — status in the message only
        const error = new Error('PayPal API 404: The specified resource does not exist.');

        assert.equal(isAlreadyGone(error), true, 'A PayPal 404 means the subscription is gone');
      },
    },

    // ─── the classifier: everything else ───

    {
      name: 'does-not-classify-a-stripe-outage-as-gone',
      auth: 'none',
      async run({ assert }) {
        const error = Stripe.errors.StripeAPIError.generate({
          type: 'api_error',
          statusCode: 503,
          message: 'Stripe is temporarily unavailable',
        });

        assert.equal(isAlreadyGone(error), false, 'A Stripe outage is transient, not gone');
      },
    },

    {
      name: 'does-not-classify-a-stripe-auth-failure-as-gone',
      auth: 'none',
      async run({ assert }) {
        const error = Stripe.errors.StripeAuthenticationError.generate({
          type: 'invalid_request_error',
          statusCode: 401,
          message: 'Invalid API Key provided',
        });

        assert.equal(isAlreadyGone(error), false, 'A rotated key is transient, not gone');
      },
    },

    {
      name: 'does-not-classify-a-paypal-422-as-gone',
      auth: 'none',
      async run({ assert }) {
        // PayPal answers 422 for an already-cancelled subscription too, but the
        // client surfaces no issue code — so it stays in the transient bucket
        // rather than becoming a guess that writes.
        const error = new Error('PayPal API 422: The requested action could not be performed, semantically incorrect, or failed business validation.');

        assert.equal(isAlreadyGone(error), false, 'An unreadable PayPal 422 must not force a cancellation');
      },
    },

    {
      name: 'does-not-classify-a-paypal-outage-as-gone',
      auth: 'none',
      async run({ assert }) {
        const error = new Error('PayPal API 503: Service Unavailable');

        assert.equal(isAlreadyGone(error), false, 'A PayPal outage is transient, not gone');
      },
    },

    {
      name: 'does-not-classify-a-configuration-error-as-gone',
      auth: 'none',
      async run({ assert }) {
        const error = new Error('STRIPE_SECRET_KEY environment variable is required');

        assert.equal(isAlreadyGone(error), false, 'A misconfiguration is not a missing subscription');
      },
    },

    {
      name: 'does-not-classify-an-unknown-error-as-gone',
      auth: 'none',
      async run({ assert }) {
        assert.equal(isAlreadyGone(new Error('socket hang up')), false, 'An unrecognized error must never be the one that writes');
        assert.equal(isAlreadyGone(undefined), false, 'A missing error must never be the one that writes');
      },
    },
  ],
};
