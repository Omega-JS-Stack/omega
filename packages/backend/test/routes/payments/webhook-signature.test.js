/**
 * Test: POST /payments/webhook — per-provider native signature verification
 * ([#213](https://github.com/Omega-JS-Stack/omega/issues/213)).
 *
 * The `?key=OMEGA_WEBHOOK_KEY` compare is a defense layer, not the boundary: a
 * provider that ships a signing scheme verifies its own signature over the RAW
 * request bytes the moment its secret is configured. Stripe is that provider
 * today (`STRIPE_WEBHOOK_SECRET`); `test`, `paypal`, and `chargebee` stay
 * key-only, so their events must keep flowing unsigned.
 *
 * The secret is read from the environment on every request, so the matrix
 * (configured / not configured) is driven by swapping the env var around each
 * call — the same live-env technique the production guard suite uses. The
 * handler is called directly with a real ctx built by Manager.RouteContext();
 * only `res` is a stand-in (the external sink), per the no-mock doctrine, and
 * every case uses an UNSUPPORTED event type so the verdict is the gate itself,
 * with no Firestore write behind it.
 *
 * The HTTP round trip — including the proof that Firebase hands the route the
 * raw bytes at all — lives in webhook.test.js.
 *
 * Run: npx omega test backend:routes/payments/webhook-signature
 */
const Stripe = require('stripe');

// The secret this suite signs with. Never a real one — the sandbox brand's
// committed .env carries the same shape for the HTTP round trips.
const SUITE_SECRET = 'whsec_test-signature-suite';

// Run the thunk with STRIPE_WEBHOOK_SECRET set to `secret` (or unset when null).
// verifySignature() reads it live on every call, so swapping it is the real switch.
function withStripeWebhookSecret(secret, fn) {
  const original = process.env.STRIPE_WEBHOOK_SECRET;

  if (secret === null) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  }

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
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
// `rawBody` mirrors what Firebase hands a function: the exact bytes, with
// req.body the parse of those same bytes.
async function callWebhook({ Manager, query, event, signature, omitRawBody }) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const headers = { 'content-type': 'application/json' };

  if (signature) {
    headers['stripe-signature'] = signature;
  }

  const res = recordingResponse();
  const req = {
    method: 'POST',
    headers: headers,
    query: query,
    body: JSON.parse(rawBody.toString('utf8')),
    rawBody: omitRawBody ? undefined : rawBody,
  };
  const ctx = Manager.RouteContext({ req, res }, { functionName: 'payments-webhook' });
  const handler = require('../../../src/manager/routes/payments/webhook/post.js');

  await handler({ ctx, Manager, libraries: Manager.libraries });

  return res.sent;
}

// Sign the exact bytes the request will carry.
function signatureFor(event, secret) {
  return Stripe.webhooks.generateTestHeaderString({
    payload: JSON.stringify(event),
    secret: secret || SUITE_SECRET,
  });
}

// An event type no provider supports — accepted events answer `ignored`, so the
// response separates "passed the gate" from "rejected at the gate" with no write.
const stripeEvent = (id) => ({ id: id, type: 'ping.unsupported', data: { object: {} } });
const paypalEvent = (id) => ({ id: id, event_type: 'PING.UNSUPPORTED', resource: {} });
const chargebeeEvent = (id) => ({ id: id, event_type: 'ping_unsupported', content: {} });

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

module.exports = {
  description: 'Payment webhook provider signature verification',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'stripe-valid-signature-is-accepted',
      auth: 'none',
      async run({ assert, Manager }) {
        const event = stripeEvent('_test-evt-sig-valid');

        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: event,
          signature: signatureFor(event),
        }));

        assert.equal(sent.code, 200, `A correctly signed event should pass the gate, got ${sent.code}: ${sent.body}`);
        assert.equal(sent.body.ignored, true, 'Unsupported event should be ignored past the gate');
      },
    },

    {
      name: 'stripe-missing-signature-is-rejected-when-the-secret-is-configured',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: stripeEvent('_test-evt-sig-missing'),
        }));

        assert.equal(sent.code, 401, `A missing signature should be rejected, got ${sent.code}`);
        assert.match(`${sent.body}`, /signature/i, 'The rejection should name the signature');
      },
    },

    {
      name: 'stripe-tampered-payload-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        // Signed as one event, delivered as another — the forgery the key alone can't catch.
        const signature = signatureFor(stripeEvent('_test-evt-sig-original'));

        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: stripeEvent('_test-evt-sig-tampered'),
          signature: signature,
        }));

        assert.equal(sent.code, 401, `A tampered payload should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'stripe-signature-from-another-secret-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        const event = stripeEvent('_test-evt-sig-wrong-secret');

        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: event,
          signature: signatureFor(event, 'whsec_a-different-secret'),
        }));

        assert.equal(sent.code, 401, `A signature from another secret should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'stripe-without-the-raw-body-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        // Re-serializing req.body would verify a guess, not the delivered bytes.
        const event = stripeEvent('_test-evt-sig-no-raw-body');

        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: event,
          signature: signatureFor(event),
          omitRawBody: true,
        }));

        assert.equal(sent.code, 401, `A verification with no raw bytes should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'stripe-stays-key-only-when-no-secret-is-configured',
      auth: 'none',
      async run({ assert, Manager }) {
        const sent = await withStripeWebhookSecret(null, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: VALID_KEY() },
          event: stripeEvent('_test-evt-sig-unconfigured'),
        }));

        assert.equal(sent.code, 200, `An unsigned event should still flow without a secret, got ${sent.code}: ${sent.body}`);
        assert.equal(sent.body.ignored, true, 'Unsupported event should be ignored past the gate');
      },
    },

    {
      name: 'the-key-still-gates-before-the-signature',
      auth: 'none',
      async run({ assert, Manager }) {
        const event = stripeEvent('_test-evt-sig-badkey');

        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'stripe', key: 'wrong-key' },
          event: event,
          signature: signatureFor(event),
        }));

        assert.equal(sent.code, 401, `A wrong key should still be rejected, got ${sent.code}`);
        assert.match(`${sent.body}`, /Invalid key/, 'The key should be the first rejection');
      },
    },

    {
      name: 'test-provider-events-are-never-signature-gated',
      auth: 'none',
      async run({ assert, Manager }) {
        // The test provider fabricates Stripe-SHAPED events locally and signs nothing.
        const sent = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'test', key: VALID_KEY() },
          event: stripeEvent('_test-evt-sig-test-provider'),
        }));

        assert.equal(sent.code, 200, `Test provider events should flow unsigned, got ${sent.code}: ${sent.body}`);
        assert.equal(sent.body.ignored, true, 'Unsupported event should be ignored past the gate');
      },
    },

    {
      name: 'paypal-and-chargebee-events-flow-unsigned',
      auth: 'none',
      async run({ assert, Manager }) {
        // Neither carries a verifier yet — a stripe secret must not gate them.
        const paypal = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'paypal', key: VALID_KEY() },
          event: paypalEvent('_test-evt-sig-paypal'),
        }));

        assert.equal(paypal.code, 200, `PayPal events should flow unsigned, got ${paypal.code}: ${paypal.body}`);
        assert.equal(paypal.body.ignored, true, 'Unsupported PayPal event should be ignored past the gate');

        const chargebee = await withStripeWebhookSecret(SUITE_SECRET, () => callWebhook({
          Manager,
          query: { provider: 'chargebee', key: VALID_KEY() },
          event: chargebeeEvent('_test-evt-sig-chargebee'),
        }));

        assert.equal(chargebee.code, 200, `Chargebee events should flow unsigned, got ${chargebee.code}: ${chargebee.body}`);
        assert.equal(chargebee.body.ignored, true, 'Unsupported Chargebee event should be ignored past the gate');
      },
    },
  ],
};
