/**
 * The brand-defined connection provider, end to end against the emulator
 * ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)).
 *
 * `src/connections/sandbox-pkce.js` is this brand's own provider file — the
 * framework ships nothing for it. What this proves, over the real routes:
 *
 *   1. the lane LOADS a provider the framework never heard of (the brand dir
 *      is searched before the package's);
 *   2. `pkce: 'S256'` is enough: the authorize URL carries `code_challenge` +
 *      `code_challenge_method`, and the verifier is stored beside the CSRF
 *      token in `usage/<uid>` instead of travelling;
 *   3. the exchange sends `code_verifier`, and it is the one that hashes to
 *      the challenge the authorize leg published;
 *   4. the record lands at `users/<uid>.connections['sandbox-pkce']` and the
 *      one-time session entry is deleted.
 *
 * The one stand-in is the AUTHORIZATION SERVER: `sandbox-pkce.js` points at
 * `http://127.0.0.1:5310`, and this file boots a plain node server there for
 * the run. Nothing leaves the machine, and the request body it records is the
 * only way to see what the exchange actually posted.
 *
 * Run (from this target, with the emulator up): npx omega test routes/connections-pkce
 */

const http = require('http');
const crypto = require('crypto');
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');
const provider = require('../../src/connections/sandbox-pkce.js');

const PROVIDER_ID = 'sandbox-pkce';
const TOKEN_URL = new URL(provider.urls.token);

// What the fake authorization server answers the exchange with
const TOKEN_RESPONSE = {
  access_token: 'sandbox-access-token',
  refresh_token: 'sandbox-refresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'sandbox:read',
  user_id: 'sandbox-user-771',
};

/** base64url(sha256(verifier)) — RFC 7636's S256, computed here independently. */
function challengeFor(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Boot the fake authorization server, recording every body it is posted.
 * @param {object[]} received - The sink for the posted bodies
 * @returns {Promise<object>} The listening server
 */
function startAuthServer(received) {
  const server = http.createServer((request, response) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        url: request.url,
        body: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString())),
      });

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(TOKEN_RESPONSE));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(TOKEN_URL.port), '127.0.0.1', () => resolve(server));
  });
}

module.exports = defineCases({
  description: 'Connections: the brand-defined sandbox-pkce provider, authorize → tokenize',
  type: 'suite',
  timeout: 30000,

  // The listening socket is the one thing that must be given back, or the run
  // never exits. (Firestore state is flushed at the START of every run.)
  async cleanup({ state }) {
    if (state.server) {
      await new Promise((resolve) => state.server.close(resolve));
    }
  },

  tests: [
    {
      name: 'boot-the-fake-authorization-server',

      async run({ state }) {
        state.received = [];
        state.server = await startAuthServer(state.received);
      },
    },

    {
      name: 'authorize-carries-the-challenge-and-stores-the-verifier',

      async run({ http: request, firestore, assert, state, accounts }) {
        const response = await request.as('basic').get('omega/user/connections', {
          provider: PROVIDER_ID,
          action: 'authorize',
          redirect: false,
        });

        assert.isSuccess(response, 'a provider only the BRAND ships is loaded by the lane');

        const url = new URL(response.data.url);

        assert.equal(url.origin + url.pathname, provider.urls.authorize, "the brand provider's own authorize url");
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256', 'the declaration is enough to turn PKCE on');
        assert.ok(url.searchParams.get('code_challenge'), 'and the challenge rides the URL');
        assert.equal(url.searchParams.get('code_verifier'), null, 'the verifier never does');

        state.encryptedState = url.searchParams.get('state');
        state.challenge = url.searchParams.get('code_challenge');

        const usage = await firestore.get(`usage/${accounts.basic.uid}`);
        const session = usage?.connections?.[PROVIDER_ID];

        assert.ok(session?.verifier, 'the verifier is stored server-side, beside the CSRF token');
        assert.equal(challengeFor(session.verifier), state.challenge, 'and it is the one the published challenge hashes from');

        state.verifier = session.verifier;
      },
    },

    {
      name: 'tokenize-sends-the-verifier-and-lands-the-record',

      async run({ http: request, firestore, assert, state, accounts }) {
        const response = await request.as('basic').post('omega/user/connections', {
          action: 'tokenize',
          code: 'sandbox-authorization-code',
          encryptedState: state.encryptedState,
        });

        assert.isSuccess(response, 'the exchange completes');

        const exchange = state.received.find((entry) => entry.url.startsWith('/token'));

        assert.ok(exchange, 'the token endpoint was called');
        assert.equal(exchange.body.code_verifier, state.verifier, 'with the verifier the authorize leg minted');
        assert.equal(exchange.body.grant_type, 'authorization_code', 'as an authorization-code exchange');
        assert.equal(exchange.body.code, 'sandbox-authorization-code', 'carrying the code');

        const user = await firestore.get(`users/${accounts.basic.uid}`);
        const record = user?.connections?.[PROVIDER_ID];

        assert.ok(record, 'the connection is recorded under the user');
        assert.equal(record.token.access_token, TOKEN_RESPONSE.access_token, 'with the access token');
        assert.equal(record.token.refresh_token, TOKEN_RESPONSE.refresh_token, 'and the refresh token');
        assert.equal(record.identity.id, TOKEN_RESPONSE.user_id, "and the provider's own identity");
        assert.equal(record.type, 'oauth2', 'and the KIND of connection it is (#788)');

        const usage = await firestore.get(`usage/${accounts.basic.uid}`);

        assert.equal(usage?.connections?.[PROVIDER_ID], undefined, 'the one-time session (CSRF + verifier) is deleted');
      },
    },
  ],
});
