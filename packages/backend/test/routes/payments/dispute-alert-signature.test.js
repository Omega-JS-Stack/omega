/**
 * Test: POST /payments/dispute-alert — Chargeblast's native signature
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A dispute alert drives a refund and a force-cancel, so it is the highest-stakes
 * unauthenticated input the backend takes. The `?key=OMEGA_WEBHOOK_KEY` compare
 * is a defense layer, not the boundary: Chargeblast signs every delivery over
 * Svix's scheme (`svix-id`, `svix-timestamp`, `svix-signature`; base64
 * HMAC-SHA256 of `<id>.<timestamp>.<raw body>` keyed by the decoded half of a
 * `whsec_<base64>` secret), and the route verifies it strictly the moment
 * CHARGEBLAST_WEBHOOK_SECRET is set. Unset, the route stays key-only and warns.
 *
 * The secret is read from the environment on every request, so the matrix is
 * driven by swapping the env var around each call — the same live-env technique
 * webhook-signature.test.js uses. Rejections happen before normalize(), so no
 * rejected case can leave a Firestore doc behind, and each accepted case carries
 * its own alert id.
 *
 * Run: npx omega test backend:routes/payments/dispute-alert-signature
 */
const crypto = require('crypto');
const { callHandler, withEnvironment } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/dispute-alert/post.js');

// The secret this suite signs with. Never a real one — `whsec_` + base64 bytes,
// the shape Chargeblast issues.
const SUITE_SECRET = `whsec_${Buffer.from('omega-dispute-alert-suite').toString('base64')}`;

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

// A minimal well-formed Chargeblast alert.
const alertBody = (id) => ({
  id: id,
  card: '4242',
  cardBrand: 'Visa',
  amount: 12.34,
  transactionDate: '2026-03-07 14:30:00',
});

// Sign the exact bytes the request will carry, Chargeblast's own way.
function svixHeaders(body, { secret, id, timestamp, signature } = {}) {
  const svixId = id || `msg_${body.id}`;
  const svixTimestamp = timestamp || `${Math.floor(Date.now() / 1000)}`;
  const secretBytes = Buffer.from((secret || SUITE_SECRET).split('_')[1], 'base64');
  const computed = crypto
    .createHmac('sha256', secretBytes)
    .update(`${svixId}.${svixTimestamp}.${JSON.stringify(body)}`)
    .digest('base64');

  return {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': `v1,${signature || computed}`,
  };
}

// Deliver an alert whose rawBody is the exact bytes req.body parses from —
// what Firebase hands the route.
function deliver(Manager, { body, headers, omitRawBody }) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-dispute-alert',
    req: {
      query: { key: VALID_KEY() },
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: body,
      rawBody: omitRawBody ? undefined : Buffer.from(JSON.stringify(body)),
    },
  });
}

const withSecret = (secret, fn) => withEnvironment({ CHARGEBLAST_WEBHOOK_SECRET: secret }, fn);

module.exports = {
  description: 'Dispute alert provider signature verification',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-correctly-signed-alert-is-accepted',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const body = alertBody('_test-dispute-sig-valid');

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, { body, headers: svixHeaders(body) }));

        assert.equal(sent.code, 200, `A correctly signed alert should pass the gate, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(sent.body.received, true, 'The alert should be received');
        assert.ok(await firestore.exists(`payments-disputes/${body.id}`), 'A verified alert should be stored');
      },
    },

    {
      name: 'an-unsigned-alert-is-rejected-when-the-secret-is-configured',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const body = alertBody('_test-dispute-sig-missing');

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, { body }));

        assert.equal(sent.code, 401, `An unsigned alert should be rejected, got ${sent.code}`);
        assert.match(`${sent.body}`, /signature/i, 'The rejection should name the signature');
        assert.equal(await firestore.exists(`payments-disputes/${body.id}`), false, 'A rejected alert must never reach Firestore');
      },
    },

    {
      name: 'a-tampered-payload-is-rejected',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        // Signed as one alert, delivered as another — the forgery the key alone cannot catch.
        const headers = svixHeaders(alertBody('_test-dispute-sig-original'));
        const body = alertBody('_test-dispute-sig-tampered');

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, { body, headers }));

        assert.equal(sent.code, 401, `A tampered payload should be rejected, got ${sent.code}`);
        assert.equal(await firestore.exists(`payments-disputes/${body.id}`), false, 'A rejected alert must never reach Firestore');
      },
    },

    {
      name: 'a-signature-from-another-secret-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        const body = alertBody('_test-dispute-sig-wrong-secret');
        const headers = svixHeaders(body, { secret: `whsec_${Buffer.from('a-different-secret').toString('base64')}` });

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, { body, headers }));

        assert.equal(sent.code, 401, `A signature from another secret should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'a-replayed-alert-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        // A correctly signed capture from an hour ago: valid HMAC, stale timestamp.
        const body = alertBody('_test-dispute-sig-replay');
        const headers = svixHeaders(body, { timestamp: `${Math.floor(Date.now() / 1000) - 3600}` });

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, { body, headers }));

        assert.equal(sent.code, 401, `A stale delivery should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'a-delivery-without-the-raw-body-is-rejected',
      auth: 'none',
      async run({ assert, Manager }) {
        // Re-serializing req.body would verify a guess, not the delivered bytes.
        const body = alertBody('_test-dispute-sig-no-raw-body');

        const sent = await withSecret(SUITE_SECRET, () => deliver(Manager, {
          body,
          headers: svixHeaders(body),
          omitRawBody: true,
        }));

        assert.equal(sent.code, 401, `A verification with no raw bytes should be rejected, got ${sent.code}`);
      },
    },

    {
      name: 'alerts-stay-key-only-when-no-secret-is-configured',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const body = alertBody('_test-dispute-sig-unconfigured');

        const sent = await withSecret(null, () => deliver(Manager, { body }));

        assert.equal(sent.code, 200, `An unsigned alert should still flow without a secret, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(await firestore.exists(`payments-disputes/${body.id}`), 'A key-only alert should be stored');
      },
    },

    {
      name: 'the-key-still-gates-before-the-signature',
      auth: 'none',
      async run({ assert, Manager }) {
        const body = alertBody('_test-dispute-sig-badkey');

        const sent = await withSecret(SUITE_SECRET, () => callHandler({
          Manager,
          handler,
          functionName: 'payments-dispute-alert',
          req: {
            query: { key: 'wrong-key' },
            headers: { 'content-type': 'application/json', ...svixHeaders(body) },
            body: body,
            rawBody: Buffer.from(JSON.stringify(body)),
          },
        }));

        assert.equal(sent.code, 401, `A wrong key should still be rejected, got ${sent.code}`);
        assert.match(`${sent.body}`, /Invalid key/, 'The key should be the first rejection');
      },
    },
  ],
};
