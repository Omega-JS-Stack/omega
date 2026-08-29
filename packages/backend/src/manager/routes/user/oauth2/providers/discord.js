const fetch = require('wonderful-fetch');
const { logIdentityCheck } = require('../_helpers.js');

module.exports = {
  provider: 'discord',
  name: 'Discord',
  urls: {
    authorize: 'https://discord.com/api/oauth2/authorize',
    tokenize: 'https://discord.com/api/oauth2/token',
    refresh: 'https://discord.com/api/oauth2/token',
    revoke: 'https://discord.com/api/oauth2/token/revoke',
    status: '',
    removeAccess: 'https://discord.com/channels/@me',
  },
  scope: ['identify', 'email'],

  // Discord doesn't need special auth params
  authParams: {},

  // Revoke a token with Discord
  async revokeToken(token, context) {
    const { ctx, clientId, clientSecret } = context;

    const response = await fetch(this.urls.revoke, {
      method: 'POST',
      timeout: 60000,
      body: new URLSearchParams({
        token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(e => e);

    if (response instanceof Error) {
      ctx.log('Discord revokeToken error:', response.message);
      return { revoked: false, reason: response.message };
    }

    return { revoked: true };
  },

  async verifyIdentity(tokenizeResult, Manager, ctx, uid) {
    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, tokenizeResult: tokenizeResult });

    // Get identity from Discord API
    const identityResponse = await fetch('https://discord.com/api/users/@me', {
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
      .where('oauth2.discord.identity.id', '==', identityResponse.id)
      .get();

    if (snap.size > 0) {
      throw new Error(`This Discord account is already connected to a ${Manager.config.brand.name} account`);
    }

    return identityResponse;
  },
};
