/**
 * This brand's own provider (`src/connections/sandbox-pkce.js`), end to end
 * over the real routes: the lane loads it, `pkce: 'S256'` puts the challenge
 * on the authorize URL and keeps the verifier in `usage/<uid>`, the exchange
 * posts that verifier, and the record lands at `users/<uid>.connections
 * ['sandbox-pkce'][<identity id>]` with the one-time session deleted.
 *
 * The one stand-in is the authorization server: a plain node server on
 * `http://127.0.0.1:5310`, booted here, recording what the exchange posted.
 *
 * Run (from this target, with the emulator up): npx omega test routes/connections-pkce
 */

const http = require('http');
const crypto = require('crypto');
const { defineCases } = require('@omega.js/backend/test');
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

      async run({ http: request, firestore, expect, state, accounts }) {
        const response = await request.as('basic').get('omega/user/connections', {
          provider: PROVIDER_ID,
          action: 'authorize',
          redirect: false,
        });

        expect(response, 'a provider only the BRAND ships is loaded by the lane').toBeSuccess();

        const url = new URL(response.data.url);

        expect(url.origin + url.pathname, "the brand provider's own authorize url").toBe(provider.urls.authorize);
        expect(url.searchParams.get('code_challenge_method'), 'the declaration is enough to turn PKCE on').toBe('S256');
        expect(url.searchParams.get('code_challenge'), 'and the challenge rides the URL').toBeTruthy();
        expect(url.searchParams.get('code_verifier'), 'the verifier never does').toBe(null);

        state.encryptedState = url.searchParams.get('state');
        state.challenge = url.searchParams.get('code_challenge');

        const usage = await firestore.get(`usage/${accounts.basic.uid}`);
        const session = usage?.connections?.[PROVIDER_ID];

        expect(session?.verifier, 'the verifier is stored server-side, beside the CSRF token').toBeTruthy();
        expect(challengeFor(session.verifier), 'and it is the one the published challenge hashes from').toBe(state.challenge);

        state.verifier = session.verifier;
      },
    },

    {
      name: 'tokenize-sends-the-verifier-and-lands-the-record',

      async run({ http: request, firestore, expect, state, accounts }) {
        const response = await request.as('basic').post('omega/user/connections', {
          action: 'tokenize',
          code: 'sandbox-authorization-code',
          encryptedState: state.encryptedState,
        });

        expect(response, 'the exchange completes').toBeSuccess();

        const exchange = state.received.find((entry) => entry.url.startsWith('/token'));

        expect(exchange, 'the token endpoint was called').toBeTruthy();
        expect(exchange.body.code_verifier, 'with the verifier the authorize leg minted').toBe(state.verifier);
        expect(exchange.body.grant_type, 'as an authorization-code exchange').toBe('authorization_code');
        expect(exchange.body.code, 'carrying the code').toBe('sandbox-authorization-code');

        const user = await firestore.get(`users/${accounts.basic.uid}`);
        const record = user?.connections?.[PROVIDER_ID]?.[TOKEN_RESPONSE.user_id];

        expect(record, 'the connection is recorded under the user, keyed by its identity id').toBeTruthy();
        expect(record.token.access_token, 'with the access token').toBe(TOKEN_RESPONSE.access_token);
        expect(record.token.refresh_token, 'and the refresh token').toBe(TOKEN_RESPONSE.refresh_token);
        expect(record.identity.id, "and the provider's own identity").toBe(TOKEN_RESPONSE.user_id);
        expect(record.type, 'and the KIND of connection it is (#788)').toBe('oauth2');

        const usage = await firestore.get(`usage/${accounts.basic.uid}`);

        expect(usage?.connections?.[PROVIDER_ID], 'the one-time session (CSRF + verifier) is deleted').toBe(undefined);
      },
    },
  ],
});
