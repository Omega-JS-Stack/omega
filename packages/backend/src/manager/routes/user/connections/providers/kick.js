const { logIdentityCheck } = require('../_providers.js');

module.exports = {
  provider: 'kick',
  name: 'Kick',
  urls: {
    authorize: 'https://id.kick.com/oauth/authorize',
    token: 'https://id.kick.com/oauth/token',
    revoke: 'https://id.kick.com/oauth/revoke',
    removeAccess: 'https://kick.com/dashboard/settings/connections',
  },
  scope: ['user:read'],

  // Kick is OAuth 2.1: the authorization code grant REQUIRES a code challenge,
  // so the declaration is the whole of what the provider adds — the lane mints
  // the verifier, stores it and sends it back at the exchange
  pkce: 'S256',

  // Kick's revoke names WHICH token it was handed, which the RFC 7009 default
  // does not send
  async revoke(context) {
    const { token, fetch } = context;

    await fetch(this.urls.revoke, {
      method: 'POST',
      timeout: 60000,
      body: new URLSearchParams({
        token: token.access_token,
        token_hint_type: 'access_token',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  async identity(context) {
    const { ctx, uid, token, fetch } = context;

    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, token: token });

    // Get identity from the Kick API
    const response = await fetch('https://api.kick.com/public/v1/users', {
      timeout: 60000,
      response: 'json',
      tries: 1,
      // NO `log: true`: wonderful-fetch prints its whole configuration, headers
      // included, and this request's authorization header IS the access token
      // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
      cacheBreaker: false,
      headers: {
        authorization: `Bearer ${token.access_token}`,
      },
    });

    // Kick answers a LIST: with no ids requested, the token's own user
    const user = response?.data?.[0];

    if (!user) {
      throw new Error('Kick returned no user for this token');
    }

    // Kick's stable account id is `user_id`, and it comes back as a NUMBER — the
    // route matches connections on a STRING `id`, so it is stringified here
    // rather than at every reader ([#793](https://github.com/Omega-JS-Stack/omega/issues/793))
    return { id: `${user.user_id}`, ...user };
  },
};
