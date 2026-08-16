/**
 * Test: the request + headers lines Middleware.process() logs
 * ([#275](https://github.com/Omega-JS-Stack/omega/issues/275)).
 *
 * The user projection closed one half of this leak; the request itself was the
 * other. Both log lines were handed the RAW channels, and every credential the
 * authenticator reads arrives on one of them: an API key rides
 * `Authorization: Bearer <api.privateKey>`, the admin key rides its own header,
 * an ID token rides the `__session` cookie, and the payload lanes are
 * `data.apiKey` / `data.authenticationToken`. So an API-key request wrote a
 * live credential into Cloud Logging before the route ever ran.
 *
 * Run: npx omega test backend:helpers/middleware-request-log
 *
 * The redaction is pure (a headers/data object in, a copy out), so it runs here
 * directly. The wiring half is proven by the emulator: every authenticated
 * route suite still round-trips green through these same two lines.
 */
const Middleware = require('../../src/manager/helpers/middleware.js');

const { redactHeadersForLog, redactDataForLog } = Middleware;

// The credentials, in the shapes the authenticator accepts them.
const PRIVATE_KEY = 'sk_live_275_private_key_value';
const ADMIN_KEY = 'omega_admin_275_key_value';
const SESSION_JWT = 'eyJhbGciOiJSUzI1NiJ9.session-275-payload.signature-275';

// Everything a redacted channel could possibly emit, as one string — the leak
// test is "does the credential appear anywhere in what gets logged".
function serialize(value) {
  return JSON.stringify(value);
}

module.exports = {
  description: 'Middleware request log redaction — no credential reaches a log line',
  type: 'group',

  tests: [
    {
      name: 'the-bearer-api-key-never-reaches-the-headers-line',
      async run({ assert }) {
        // The reported case: API-key auth arrives as a bearer header, so the
        // headers line carried a live `api.privateKey` on every API request.
        const logged = serialize(redactHeadersForLog({
          authorization: `Bearer ${PRIVATE_KEY}`,
          'content-type': 'application/json',
        }));

        assert.equal(logged.includes(PRIVATE_KEY), false, `the API key leaked into the headers line: ${logged}`);
        assert.equal(logged.includes('application/json'), true, `a non-credential header was dropped: ${logged}`);
      },
    },

    {
      name: 'every-credential-header-the-authenticator-reads-is-redacted',
      async run({ assert }) {
        // The admin key and the __session cookie are the other two header
        // lanes context/authenticate.js reads — same class of live credential.
        const logged = serialize(redactHeadersForLog({
          'omega-admin-key': ADMIN_KEY,
          cookie: `__session=${SESSION_JWT}; theme=dark`,
        }));

        assert.equal(logged.includes(ADMIN_KEY), false, `the admin key leaked into the headers line: ${logged}`);
        assert.equal(logged.includes(SESSION_JWT), false, `the session token leaked into the headers line: ${logged}`);
      },
    },

    {
      name: 'the-payload-credential-channels-are-redacted',
      async run({ assert }) {
        // The body/query lanes: `apiKey` and `authenticationToken` land in
        // ctx.request.data, which the request line stringifies whole.
        const logged = serialize(redactDataForLog({
          apiKey: PRIVATE_KEY,
          authenticationToken: SESSION_JWT,
          message: 'hello',
        }));

        assert.equal(logged.includes(PRIVATE_KEY), false, `data.apiKey leaked into the request line: ${logged}`);
        assert.equal(logged.includes(SESSION_JWT), false, `data.authenticationToken leaked into the request line: ${logged}`);
        assert.equal(logged.includes('hello'), true, `a non-credential field was dropped: ${logged}`);
      },
    },

    {
      name: 'a-redacted-channel-still-reports-presence-and-last-4',
      async run({ assert }) {
        // Same shape the authenticator's own lines use: enough to tell "a key
        // was sent" and to match it against a known key, never the key itself.
        const headers = redactHeadersForLog({ authorization: `Bearer ${PRIVATE_KEY}` });
        const data = redactDataForLog({ apiKey: PRIVATE_KEY });

        assert.equal(headers.authorization, 'Bearer ***alue (29 chars)', serialize(headers));
        assert.equal(data.apiKey, '***alue (29 chars)', serialize(data));
      },
    },

    {
      name: 'redaction-never-mutates-the-request',
      async run({ assert }) {
        // ctx.request.headers IS req.headers and ctx.request.data is what the
        // route handler reads next — a redaction that wrote through would
        // break authentication itself.
        const headers = { authorization: `Bearer ${PRIVATE_KEY}` };
        const data = { apiKey: PRIVATE_KEY, nested: { keep: true } };

        const redactedData = redactDataForLog(data);

        redactHeadersForLog(headers);

        assert.equal(headers.authorization, `Bearer ${PRIVATE_KEY}`, 'the headers object was mutated');
        assert.equal(data.apiKey, PRIVATE_KEY, 'the request data was mutated');
        assert.equal(redactedData.nested, data.nested, 'untouched branches are carried by reference');
      },
    },

    {
      name: 'a-request-without-credentials-passes-through-unchanged',
      async run({ assert }) {
        // The common case must stay fully readable — the line is the primary
        // request trace.
        const headers = { 'content-type': 'application/json', 'user-agent': 'omega-test' };
        const data = { name: 'set-a', count: 3 };

        assert.deepEqual(redactHeadersForLog(headers), headers);
        assert.deepEqual(redactDataForLog(data), data);
        assert.deepEqual(redactHeadersForLog(undefined), {});
        assert.deepEqual(redactDataForLog(undefined), {});
      },
    },
  ],
};
