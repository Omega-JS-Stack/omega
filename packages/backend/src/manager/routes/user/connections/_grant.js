/**
 * The steps a connection is made of, and the ONE context every one of them is
 * called with ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)).
 *
 * A provider module declares data (`urls`, `scope`, `params`, `pkce`) and, for
 * anything the data cannot say, a function. Every function — the provider's own
 * or the default below — is called as a METHOD on the module (`this.urls.*`
 * keeps working) and receives the same object:
 *
 *   { provider, providerName, Manager, ctx, uid, clientId, clientSecret,
 *     redirectUri, scope, state, pkce, code, token, fetch }
 *
 * `pkce` is `{ verifier, challenge }` when the provider declares `pkce: 'S256'`
 * and null otherwise; `code` is the authorization code (exchange); `token` is
 * the exchange RESPONSE for `identity` and the STORED record for `refresh`,
 * `revoke` and `status`. `fetch` is the lane's HTTP call, handed in so a step
 * has ONE seam.
 *
 * One concern, one file: nothing here reads the environment or loads a module.
 */

const fetch = require('wonderful-fetch');
const { arrayify } = require('node-powertools');

// How long the REFRESH step may spend at the provider
// ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)). It is shorter
// than the exchange's 60s on purpose: a refresh runs while holding the lease in
// `_lease.js`, and a call that outlived the lease would let a second caller
// reclaim it and spend the same one-time refresh token. That file asserts the
// relationship at load, reading THIS constant, so the two can never drift.
const REFRESH_TIMEOUT_MS = 20000;

// What the default `revoke` answers for a provider that declares no
// `urls.revoke`: there is nothing to call, the record is still deleted, and the
// route says which of the two happened
const REVOKE_UNSUPPORTED = 'unsupported';

/**
 * The one context object every step is called with — the ONE home of its shape.
 * Keys the step at hand has no use for are present and undefined, so a provider
 * author reads one table and never wonders which call site they are in.
 *
 * @param {object} parts - Whatever the route resolved
 * @returns {object} The step context
 */
function buildGrantContext({
  provider,
  providerName,
  Manager,
  ctx,
  uid,
  clientId,
  clientSecret,
  redirectUri,
  scope,
  state,
  pkce,
  code,
  token,
}) {
  return {
    provider,
    providerName,
    Manager,
    ctx,
    uid,
    clientId,
    clientSecret,
    redirectUri,
    scope,
    state,
    pkce: pkce || null,
    code,
    token,
    fetch,
  };
}

/**
 * The authorization URL a redirect flow sends the user to.
 *
 * @param {object} context - The step context
 * @returns {string} The authorization URL
 */
function defaultAuthorize(context) {
  const { provider, clientId, redirectUri, scope, state, pkce } = context;

  const url = new URL(provider.urls.authorize);

  url.searchParams.set('state', state);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', arrayify(scope).join(' '));

  // Provider-specific authorize params
  for (const [key, value] of Object.entries(provider.params || {})) {
    url.searchParams.set(key, value);
  }

  // PKCE: the challenge travels, the verifier never does
  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}

/**
 * Exchange the authorization code for tokens.
 *
 * @param {object} context - The step context
 * @returns {Promise<object>} The token response
 */
function defaultExchange(context) {
  const { provider, clientId, clientSecret, redirectUri, code, pkce, fetch: call } = context;

  const body = {
    client_id: clientId,
    // A PUBLIC client has no secret to send
    // ([#785](https://github.com/Omega-JS-Stack/omega/issues/785)): Twitch (and
    // any OAuth 2.1 provider) registers one, the brand holds an id alone, and an
    // EMPTY `client_secret` is not the same request as no `client_secret` — the
    // token endpoint reads the field as a wrong secret and refuses the grant.
    // The key is omitted when the `CONNECTIONS_<PROVIDER>_CLIENT_SECRET` key is
    // unset or empty; a confidential client's body is unchanged, field for field.
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: code,
  };

  if (pkce) {
    body.code_verifier = pkce.verifier;
  }

  return call(provider.urls.token, {
    method: 'POST',
    timeout: 60000,
    response: 'json',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/**
 * Refresh an access token from the stored record.
 *
 * @param {object} context - The step context
 * @returns {Promise<object>} The token response
 */
function defaultRefresh(context) {
  const { provider, clientId, clientSecret, token, fetch: call } = context;

  const body = {
    client_id: clientId,
    // Omitted for a public client, exactly as in the exchange above
    // ([#785](https://github.com/Omega-JS-Stack/omega/issues/785))
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  };

  return call(provider.urls.token, {
    method: 'POST',
    timeout: REFRESH_TIMEOUT_MS,
    response: 'json',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/**
 * Revoke the access token at the provider — RFC 7009: a form POST carrying the
 * token, plus the client credentials the provider knows this app by.
 *
 * A provider that declares no `urls.revoke` cannot revoke at all (Spotify), and
 * says so rather than pretending: the answer is `'unsupported'`, and the delete
 * removes the record either way. Every other outcome is silence (revoked) or a
 * throw (the route reports it and still deletes).
 *
 * @param {object} context - The step context (`token` is the stored record)
 * @returns {Promise<string|undefined>} `'unsupported'`, or nothing
 */
async function defaultRevoke(context) {
  const { provider, clientId, clientSecret, token, fetch: call } = context;

  if (!provider.urls?.revoke) {
    return REVOKE_UNSUPPORTED;
  }

  await call(provider.urls.revoke, {
    method: 'POST',
    timeout: 60000,
    body: new URLSearchParams({
      token: token.access_token,
      ...(clientId ? { client_id: clientId } : {}),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

// The steps the lane can run without the provider's help. `identity` is not
// here: nothing can guess whose account a token belongs to, which is why
// assertProviderShape requires it. Neither is `status`: without one, a stored
// refresh token IS the answer.
const GRANT_DEFAULTS = {
  authorize: defaultAuthorize,
  exchange: defaultExchange,
  refresh: defaultRefresh,
  revoke: defaultRevoke,
};

/**
 * Run one step: the provider's own function when it declares one, else the
 * default — always as a method on the module.
 *
 * @param {object} provider - The provider module
 * @param {'authorize'|'exchange'|'identity'|'refresh'|'revoke'|'status'} step - The step to run
 * @param {object} context - The step context
 * @returns {*} Whatever the step answers (a URL string, a token response, an identity)
 * @throws {Error} When the step has neither an override nor a default
 */
function runStep(provider, step, context) {
  const fn = typeof provider[step] === 'function' ? provider[step] : GRANT_DEFAULTS[step];

  if (typeof fn !== 'function') {
    // A programmer error: the route asked for a step this provider cannot run
    // and the lane has no default for. Loud here beats a TypeError at the seam.
    throw new Error(`Connection provider ${provider.provider} declares no ${step}() and the lane has no default for it`);
  }

  return fn.call(provider, context);
}

module.exports = {
  REFRESH_TIMEOUT_MS,
  REVOKE_UNSUPPORTED,
  buildGrantContext,
  defaultAuthorize,
  defaultExchange,
  defaultRefresh,
  defaultRevoke,
  runStep,
};
