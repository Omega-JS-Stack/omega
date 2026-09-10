const { logIdentityCheck } = require('../_providers.js');

module.exports = {
  provider: 'spotify',
  name: 'Spotify',
  urls: {
    authorize: 'https://accounts.spotify.com/authorize',
    token: 'https://accounts.spotify.com/api/token',
    // No `revoke`: Spotify has no revocation endpoint, so a disconnect drops the
    // record and says the provider could not be told
    // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793))
    removeAccess: 'https://www.spotify.com/account/apps/',
  },
  scope: ['user-read-email', 'user-read-private'],

  async identity(context) {
    const { ctx, uid, token, fetch } = context;

    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, token: token });

    // Get identity from Spotify API
    const identity = await fetch('https://api.spotify.com/v1/me', {
      timeout: 60000,
      response: 'json',
      tries: 1,
      // NO `log: true`: wonderful-fetch prints its whole configuration, headers
      // included, and this request's authorization header IS the access token
      // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
      cacheBreaker: false,
      headers: {
        authorization: `${token.token_type} ${token.access_token}`,
      },
    });

    // Spotify's own `id` is already the stable account id the route matches on
    return identity;
  },
};
