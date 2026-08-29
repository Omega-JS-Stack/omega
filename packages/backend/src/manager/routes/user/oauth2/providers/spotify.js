const fetch = require('wonderful-fetch');
const { logIdentityCheck } = require('../_helpers.js');

module.exports = {
  provider: 'spotify',
  name: 'Spotify',
  urls: {
    authorize: 'https://accounts.spotify.com/authorize',
    tokenize: 'https://accounts.spotify.com/api/token',
    refresh: 'https://accounts.spotify.com/api/token',
    revoke: '',
    status: '',
    removeAccess: 'https://www.spotify.com/account/apps/',
  },
  scope: ['user-read-email', 'user-read-private'],

  // Spotify doesn't need special auth params
  authParams: {},

  // Spotify does not support token revocation
  async revokeToken(token, context) {
    const { ctx } = context;

    ctx.log('Spotify does not support token revocation');

    return { revoked: false, reason: 'Spotify does not support token revocation' };
  },

  async verifyIdentity(tokenizeResult, Manager, ctx, uid) {
    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, tokenizeResult: tokenizeResult });

    // Get identity from Spotify API
    const identityResponse = await fetch('https://api.spotify.com/v1/me', {
      timeout: 60000,
      response: 'json',
      tries: 1,
      // NO `log: true`: wonderful-fetch prints its whole configuration, headers
      // included, and this request's authorization header IS the access token
      // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
      cacheBreaker: false,
      headers: {
        authorization: `${tokenizeResult.token_type} ${tokenizeResult.access_token}`,
      },
    });

    // Check if exists
    const snap = await Manager.libraries.admin.firestore().collection('users')
      .where('oauth2.spotify.identity.id', '==', identityResponse.id)
      .get();

    if (snap.size > 0) {
      throw new Error(`This Spotify account is already connected to a ${Manager.config.brand.name} account`);
    }

    return identityResponse;
  },
};
