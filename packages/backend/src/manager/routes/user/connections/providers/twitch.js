const { logIdentityCheck } = require('../_providers.js');

module.exports = {
  provider: 'twitch',
  name: 'Twitch',
  urls: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    revoke: 'https://id.twitch.tv/oauth2/revoke',
    removeAccess: 'https://www.twitch.tv/settings/connections',
  },
  scope: ['user:read:email'],

  // Twitch is a plain authorization-code provider: no PKCE, no extra params,
  // and its revoke is the RFC 7009 form POST the lane already sends

  async identity(context) {
    const { ctx, uid, token, clientId, fetch } = context;

    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, token: token });

    // Get identity from the Twitch API. Helix wants the app's client id BESIDE
    // the bearer token on every call, and the context carries it — the same pair
    // the route exchanged the code with
    // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793))
    const response = await fetch('https://api.twitch.tv/helix/users', {
      timeout: 60000,
      response: 'json',
      tries: 1,
      // NO `log: true`: wonderful-fetch prints its whole configuration, headers
      // included, and this request's authorization header IS the access token
      // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
      cacheBreaker: false,
      headers: {
        'Client-Id': clientId,
        authorization: `Bearer ${token.access_token}`,
      },
    });

    // Helix answers a LIST: the token's own user is the only entry
    const identity = response?.data?.[0];

    if (!identity) {
      throw new Error('Twitch returned no user for this token');
    }

    // Helix's own `id` is already the stable account id the route matches on
    return identity;
  },
};
