/**
 * sandbox-pkce — a BRAND-defined connection provider
 * ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)).
 *
 * The whole of what a brand adds for a new connection: this file, a
 * `connections` entry in the brand config, and the
 * CONNECTIONS_SANDBOX_PKCE_CLIENT_ID / _SECRET pair in the .env. Nothing in the
 * framework knows this provider exists — the lane resolves
 * `${Manager.cwd}/connections/<name>.js` before its own directory.
 *
 * `pkce: 'S256'` is the only thing this provider declares beyond the shape:
 * the lane mints the verifier, stores it beside the CSRF token, sends the
 * challenge on the authorize leg and the verifier at the exchange.
 *
 * It talks to a FAKE authorization server the project test boots on this
 * machine (test/routes/connections-pkce.test.js) — the sandbox brand never reaches
 * a real service, and this provider exists to prove the round trip.
 */

// The fake authorization server. The test reads these URLs to know where to
// listen, so the port lives here once.
const AUTH_SERVER = 'http://127.0.0.1:5310';

module.exports = {
  provider: 'sandbox-pkce',
  name: 'Sandbox PKCE',
  urls: {
    authorize: `${AUTH_SERVER}/authorize`,
    // One endpoint for the exchange AND the refresh, as at every provider
    // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793))
    token: `${AUTH_SERVER}/token`,
    removeAccess: `${AUTH_SERVER}/connections`,
  },
  scope: ['sandbox:read'],

  // OAuth 2.1: the authorization code grant carries a code challenge
  pkce: 'S256',

  async identity(context) {
    const { ctx, uid, token } = context;

    // Provider, owner, outcome — never the exchange response
    // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641))
    ctx.log(`identity(): provider=${this.provider}, uid=${uid || 'null'}, tokenExchange=${token?.access_token ? 'succeeded' : 'failed'}`);

    // The fake authorization server names the user in its token response, so
    // this provider needs no second call to identify one
    return {
      id: token.user_id || 'sandbox-user',
      name: 'Sandbox User',
    };
  },
};
