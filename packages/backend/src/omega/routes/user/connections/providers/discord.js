const { logIdentityCheck } = require('../_providers.js');

module.exports = {
  provider: 'discord',
  name: 'Discord',
  urls: {
    authorize: 'https://discord.com/api/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    revoke: 'https://discord.com/api/oauth2/token/revoke',
    removeAccess: 'https://discord.com/channels/@me',
  },
  scope: ['identify', 'email'],

  // Discord needs no extra authorize params, and its revoke is the RFC 7009
  // form POST the lane already sends

  async identity(context) {
    const { ctx, uid, token, fetch } = context;

    // Provider, owner, outcome — never the token response, and never the identity
    // the API answers with ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, token: token });

    // Get identity from Discord API
    const identity = await fetch('https://discord.com/api/users/@me', {
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

    // Discord's own `id` is already the stable account id the route matches on
    return identity;
  },
};
