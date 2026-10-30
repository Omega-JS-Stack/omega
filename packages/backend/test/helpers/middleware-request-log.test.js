/**
 * Test: the request + headers lines the request pipeline logs
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
const redaction = require('../../dist/omega/helpers/log-redaction.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { redactHeadersForLog, redactDataForLog } = redaction;

// The credentials, in the shapes the authenticator accepts them.
const PRIVATE_KEY = 'sk_live_275_private_key_value';
const ADMIN_KEY = 'omega_admin_275_key_value';
const SESSION_JWT = 'eyJhbGciOiJSUzI1NiJ9.session-275-payload.signature-275';

// Everything a redacted channel could possibly emit, as one string — the leak
// test is "does the credential appear anywhere in what gets logged".
function serialize(value) {
  return JSON.stringify(value);
}

module.exports = defineCases({
  description: 'Pipeline request log redaction — no credential reaches a log line',
  type: 'group',

  tests: [
    {
      name: 'the-bearer-api-key-never-reaches-the-headers-line',
      async run({ expect }) {
        // The reported case: API-key auth arrives as a bearer header, so the
        // headers line carried a live `api.privateKey` on every API request.
        const logged = serialize(redactHeadersForLog({
          authorization: `Bearer ${PRIVATE_KEY}`,
          'content-type': 'application/json',
        }));

        expect(logged.includes(PRIVATE_KEY), `the API key leaked into the headers line: ${logged}`).toBe(false);
        expect(logged.includes('application/json'), `a non-credential header was dropped: ${logged}`).toBe(true);
      },
    },

    {
      name: 'every-credential-header-the-authenticator-reads-is-redacted',
      async run({ expect }) {
        // The admin key and the __session cookie are the other two header
        // lanes context/authenticate.js reads — same class of live credential.
        const logged = serialize(redactHeadersForLog({
          'omega-admin-key': ADMIN_KEY,
          cookie: `__session=${SESSION_JWT}; theme=dark`,
        }));

        expect(logged.includes(ADMIN_KEY), `the admin key leaked into the headers line: ${logged}`).toBe(false);
        expect(logged.includes(SESSION_JWT), `the session token leaked into the headers line: ${logged}`).toBe(false);
      },
    },

    {
      name: 'the-payload-credential-channels-are-redacted',
      async run({ expect }) {
        // The body/query lanes: `apiKey` and `authenticationToken` land in
        // ctx.request.data, which the request line stringifies whole.
        const logged = serialize(redactDataForLog({
          apiKey: PRIVATE_KEY,
          authenticationToken: SESSION_JWT,
          message: 'hello',
        }));

        expect(logged.includes(PRIVATE_KEY), `data.apiKey leaked into the request line: ${logged}`).toBe(false);
        expect(logged.includes(SESSION_JWT), `data.authenticationToken leaked into the request line: ${logged}`).toBe(false);
        expect(logged.includes('hello'), `a non-credential field was dropped: ${logged}`).toBe(true);
      },
    },

    {
      name: 'every-credential-family-is-redacted-at-any-depth',
      async run({ expect }) {
        // The request side runs the same family test the response side does:
        // a credential nested under any key is a credential, not just the two
        // exact top-level names.
        const data = { user: { password: 'x', apiKey: 'y', refresh_token: 'z' } };
        const redacted = redactDataForLog(data);
        const logged = serialize(redacted);

        for (const [key, raw] of Object.entries(data.user)) {
          expect(redacted.user[key], `data.user.${key} reached the request line raw: ${logged}`).not.toBe(raw);
          expect(String(redacted.user[key]), `data.user.${key} is rendered as redacted: ${logged}`).toMatch(/^\*\*\*/);
        }
      },
    },

    {
      name: 'a-redacted-channel-still-reports-presence-and-last-4',
      async run({ expect }) {
        // Same shape the authenticator's own lines use: enough to tell "a key
        // was sent" and to match it against a known key, never the key itself.
        const headers = redactHeadersForLog({ authorization: `Bearer ${PRIVATE_KEY}` });
        const data = redactDataForLog({ apiKey: PRIVATE_KEY });

        expect(headers.authorization, serialize(headers)).toBe('Bearer ***alue (29 chars)');
        expect(data.apiKey, serialize(data)).toBe('***alue (29 chars)');
      },
    },

    {
      name: 'redaction-never-mutates-the-request',
      async run({ expect }) {
        // ctx.request.headers IS req.headers and ctx.request.data is what the
        // route handler reads next — a redaction that wrote through would
        // break authentication itself.
        const headers = { authorization: `Bearer ${PRIVATE_KEY}` };
        const data = { apiKey: PRIVATE_KEY, nested: { keep: true } };

        const redactedData = redactDataForLog(data);

        redactHeadersForLog(headers);

        expect(headers.authorization, 'the headers object was mutated').toBe(`Bearer ${PRIVATE_KEY}`);
        expect(data.apiKey, 'the request data was mutated').toBe(PRIVATE_KEY);
        expect(redactedData.nested, 'untouched branches are carried by reference').toBe(data.nested);
      },
    },

    {
      name: 'a-request-without-credentials-passes-through-unchanged',
      async run({ expect }) {
        // The common case must stay fully readable — the line is the primary
        // request trace.
        const headers = { 'content-type': 'application/json', 'user-agent': 'omega-test' };
        const data = { name: 'set-a', count: 3 };

        expect(redactHeadersForLog(headers)).toEqual(headers);
        expect(redactDataForLog(data)).toEqual(data);
        expect(redactHeadersForLog(undefined)).toEqual({});
        expect(redactDataForLog(undefined)).toEqual({});
      },
    },
  ],
});
