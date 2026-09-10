/**
 * Test: the response line the route logger writes
 * ([#796](https://github.com/Omega-JS-Stack/omega/issues/796)).
 *
 * `ctx.respond()` logged `JSON.stringify(response)` for every route, and
 * `GET /omega/user` answers the whole user record: every connected provider's
 * `connections.<provider>.token` (access and refresh) plus `api.privateKey`.
 * That put a live third-party token and the caller's own key into Cloud
 * Logging on every read of the account page, where log retention keeps them.
 * [#275](https://github.com/Omega-JS-Stack/omega/issues/275) closed the request
 * side of the same line; this is the response side.
 *
 * Run: npx omega test backend:helpers/response-log-redaction
 *
 * The redaction is pure (a response in, a copy out), so it runs here directly.
 * The wiring half is proven by the emulator: every route suite still
 * round-trips green through this same line.
 */
const Middleware = require('../../dist/manager/helpers/middleware.js');
const { methods } = require('../../dist/manager/helpers/context/respond.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { redactResponseForLog } = Middleware;

// The credentials the reported line printed, in the shapes the user record
// carries them.
const TWITCH_ACCESS = 'tw_access_796_live_token_value';
const TWITCH_REFRESH = 'tw_refresh_796_live_token_value';
const YOUTUBE_ACCESS = 'yt_access_796_live_token_value';
const KICK_TOKEN = 'kick_796_bare_string_token_value';
const PRIVATE_KEY = 'sk_live_796_private_key_value';

// What the line is FOR: the fields that make a response trace readable.
const DISPLAY_NAME = 'OmegaStreamer796';
const EMAIL = 'user-796@example.com';

// The user record `GET /omega/user` answers, trimmed to the branches that
// matter: two connected providers, the API credential, and the identity the
// line has to keep.
function userRecord(overrides) {
  return Object.assign({
    id: 'uid-796',
    email: EMAIL,
    api: { clientId: 'client-796', privateKey: PRIVATE_KEY },
    connections: {
      twitch: {
        type: 'oauth2',
        token: { access_token: TWITCH_ACCESS, refresh_token: TWITCH_REFRESH, expires_in: 14400 },
        profile: { displayName: DISPLAY_NAME, id: '796796' },
      },
      youtube: {
        type: 'oauth2',
        token: { access_token: YOUTUBE_ACCESS },
      },
      // A provider whose `token` is the credential STRING itself, not a pair.
      kick: {
        type: 'oauth2',
        token: KICK_TOKEN,
      },
    },
  }, overrides);
}

// Everything the redacted response could possibly emit, as one string: the
// leak test is "does the credential appear anywhere in what gets logged".
function serialize(value) {
  return JSON.stringify(value);
}

// A res that records what it was handed, and a ctx carrying the REAL respond()
// methods: the point of these two cases is the wiring, so nothing between the
// call and the log line is stood in for.
function mockContext() {
  const logs = [];
  const sent = { json: [], send: [], status: [] };
  const res = {
    headersSent: false,
    status(code) { sent.status.push(code); return res; },
    header() { return res; },
    get() { return ''; },
    json(body) { sent.json.push(body); return res; },
    send(body) { sent.send.push(body); return res; },
  };
  const ctx = Object.assign({
    ref: { res },
    tag: null,
    schema: {},
    Manager: { libraries: {} },
    log: (...args) => logs.push(args.join(' ')),
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
    clearLogPrefix() {},
  }, methods);

  return { ctx, res, logs, sent };
}

// The one line the leak was about.
function responseLine(logs) {
  return logs.find((line) => line.includes('Sending response')) || '(no Sending response line)';
}

module.exports = defineCases({
  description: 'Response log redaction: no credential reaches the Sending response line',
  type: 'group',

  tests: [
    {
      name: 'no-connection-token-or-private-key-reaches-the-response-line',
      async run({ assert }) {
        const logged = serialize(redactResponseForLog(userRecord()));

        for (const secret of [TWITCH_ACCESS, TWITCH_REFRESH, YOUTUBE_ACCESS, KICK_TOKEN, PRIVATE_KEY]) {
          assert.equal(logged.includes(secret), false, `a credential leaked into the response line: ${logged}`);
        }

        assert.equal(logged.includes(DISPLAY_NAME), true, `the connection profile was dropped: ${logged}`);
        assert.equal(logged.includes(EMAIL), true, `the caller identity was dropped: ${logged}`);
        assert.equal(logged.includes('***'), true, `nothing was rendered as redacted: ${logged}`);
      },
    },

    {
      name: 'redaction-never-mutates-the-response',
      async run({ assert }) {
        // The response object is what res.json sends next, so a redaction that
        // wrote through would ship redacted tokens to the caller.
        const response = userRecord();
        const before = JSON.parse(serialize(response));

        redactResponseForLog(response);

        assert.deepEqual(response, before, 'the response object was mutated');
        assert.equal(response.connections.twitch.token.access_token, TWITCH_ACCESS, 'a connection token was rewritten');
        assert.equal(response.connections.kick.token, KICK_TOKEN, 'a string connection token was rewritten');
        assert.equal(response.api.privateKey, PRIVATE_KEY, 'the private key was rewritten');
      },
    },

    {
      name: 'a-non-object-response-passes-through',
      async run({ assert }) {
        // The error path stringifies a message string, and a route may answer
        // nothing at all. One line shape means both route through here.
        assert.equal(redactResponseForLog('Not found (omega/404)'), 'Not found (omega/404)');
        assert.equal(redactResponseForLog(null), null);
        assert.equal(redactResponseForLog(undefined), undefined);
        assert.equal(redactResponseForLog(204), 204);
      },
    },

    {
      name: 'an-array-response-is-walked',
      async run({ assert }) {
        // A list route answers records, so the walk cannot stop at the root.
        const logged = serialize(redactResponseForLog([
          userRecord({ id: 'uid-796-a' }),
          { id: 'uid-796-b', api: { privateKey: PRIVATE_KEY } },
        ]));

        assert.equal(logged.includes(TWITCH_ACCESS), false, `a credential leaked from an array item: ${logged}`);
        assert.equal(logged.includes(PRIVATE_KEY), false, `a credential leaked from an array item: ${logged}`);
        assert.equal(logged.includes('uid-796-b'), true, `an array item was dropped: ${logged}`);
      },
    },

    {
      name: 'a-credential-key-matches-whatever-its-case-or-separators',
      async run({ assert }) {
        // A key is matched lower-cased with `-` and `_` stripped, so the camel
        // and snake spellings of one field are one key. `signInToken` is the
        // admin custom token `POST /special/electron-client` answers with.
        const secrets = {
          webhook_secret: 'whsec_796_signing_value',
          ClientSecret: 'cs_796_client_secret_value',
          Access_Token: 'at_796_snake_token_value',
          accessToken: 'at_796_camel_token_value',
          private_key: 'pk_796_snake_private_key_value',
          sessionCookie: 'sc_796_session_cookie_value',
          signInToken: 'st_796_sign_in_token_value',
          password: 'pw_796_password_value',
        };
        const redacted = redactResponseForLog(Object.assign({ message: 'ok' }, secrets));
        const logged = serialize(redacted);

        for (const [key, value] of Object.entries(secrets)) {
          assert.equal(logged.includes(value), false, `${key} leaked: ${logged}`);
        }

        assert.equal(redacted.message, 'ok', `a non-credential field was dropped: ${logged}`);
        assert.equal(redacted.webhook_secret, '***alue (23 chars)', logged);
      },
    },

    {
      name: 'an-empty-credential-still-reads-as-empty',
      async run({ assert }) {
        // "No token stored" is the diagnostic the line exists for, so a null or
        // a missing credential says so instead of claiming a redacted object.
        const redacted = redactResponseForLog({ token: null, refreshToken: undefined, hasPassword: true, tokenCount: 3 });

        assert.equal(redacted.token, null, serialize(redacted));
        assert.equal(redacted.refreshToken, undefined, serialize(redacted));
        // A flag or a count under a credential-shaped name is not a secret.
        assert.equal(serialize(redacted), '{"token":null,"hasPassword":true,"tokenCount":3}', serialize(redacted));
      },
    },

    {
      name: 'a-value-that-serializes-itself-keeps-its-json-shape',
      async run({ assert }) {
        // The copy walks own properties, and a Date has none, so a walked Date
        // logged as `{}`. Anything carrying `toJSON` is walked through it, which
        // is what JSON.stringify would have shown anyway.
        const created = new Date('2026-09-04T12:00:00.000Z');
        const redacted = redactResponseForLog({ metadata: { created }, buffer: Buffer.from('796') });

        assert.equal(redacted.metadata.created, '2026-09-04T12:00:00.000Z', serialize(redacted));
        assert.equal(redacted.buffer.type, 'Buffer', serialize(redacted));
      },
    },

    {
      name: 'the-real-respond-logs-a-redacted-line-and-sends-the-original',
      async run({ assert }) {
        // The wiring: the REAL respond() with a recording res. The line is
        // redacted and the body on the wire is untouched, which is the whole
        // point of copying rather than rewriting.
        const { ctx, logs, sent } = mockContext();
        const response = userRecord();

        ctx.respond(response);

        const line = responseLine(logs);

        for (const secret of [TWITCH_ACCESS, TWITCH_REFRESH, YOUTUBE_ACCESS, KICK_TOKEN, PRIVATE_KEY]) {
          assert.equal(line.includes(secret), false, `a credential leaked into the response line: ${line}`);
        }

        assert.equal(line.includes(EMAIL), true, `the line lost its trace value: ${line}`);
        assert.deepEqual(sent.json[0], userRecord(), 'res.json received a rewritten body');
        assert.equal(sent.json[0].connections.twitch.token.access_token, TWITCH_ACCESS, 'the token on the wire was redacted');
      },
    },

    {
      name: 'the-real-respond-error-path-logs-and-sends-the-same-string',
      async run({ assert }) {
        // The error path stringifies a message, so the same call runs a string
        // through the same function: string in, string out, one line shape.
        const { ctx, logs, sent } = mockContext();

        ctx.respond('Connection refresh failed', { code: 400 });

        const line = responseLine(logs);

        assert.equal(line.includes('Connection refresh failed'), true, `the error line lost its message: ${line}`);
        assert.equal(sent.send[0], 'Connection refresh failed', `res.send received a rewritten body: ${sent.send[0]}`);
      },
    },
  ],
});
