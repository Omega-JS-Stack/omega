const { logIdentityCheck } = require('../_providers.js');
const { jwtDecode } = require('jwt-decode');

module.exports = {
  provider: 'google',
  name: 'Google',
  urls: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    removeAccess: 'https://myaccount.google.com/security',
  },
  scope: ['openid', 'email', 'profile'],

  // Google-specific authorize params
  params: {
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  },

  // Google's revoke documents `token` ALONE: the endpoint takes no client
  // credentials, and sending them is a 400
  async revoke(context) {
    const { token, fetch } = context;

    await fetch(this.urls.revoke, {
      method: 'POST',
      timeout: 60000,
      body: new URLSearchParams({ token: token.access_token }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  async identity(context) {
    const { ctx, uid, token } = context;

    // Provider, owner, outcome — never the token response, and never the decoded
    // profile ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
    logIdentityCheck(ctx, { provider: this.provider, uid: uid, token: token });

    // Decode token
    const decoded = jwtDecode(token.id_token);

    // Require email scope for proper identity verification
    if (!decoded.email) {
      throw new Error('Email scope is required. Please ensure "email" scope is included in the OAuth request.');
    }

    // `sub` is Google's stable account id, and `id` is what the route matches a
    // connection on ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)) —
    // an email can change hands, a `sub` cannot
    return { id: decoded.sub, ...decoded };
  },
};
