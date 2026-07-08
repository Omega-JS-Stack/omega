/**
 * Google service-account access tokens — the RS256 JWT-bearer grant shared
 * by every Google REST surface the manager talks to (Firestore via
 * firestore-rest.js, Firebase Auth admin via the account service). Each
 * surface needs its own OAuth scope, so callers create one provider per
 * (service account, scope) pair; the token is cached until shortly before
 * expiry.
 */
const { signJwt } = require('./jwt.js');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Create a cached access-token provider for a service account + scope.
 *
 * @param {Object} serviceAccount - Parsed service-account JSON (client_email, private_key)
 * @param {string} scope - OAuth scope, e.g. 'https://www.googleapis.com/auth/datastore'
 * @returns {{ getAccessToken: () => Promise<string> }}
 */
function createTokenProvider(serviceAccount, scope) {
  let accessToken = null;
  let tokenExpiry = 0;

  return {
    async getAccessToken() {
      if (accessToken && Date.now() < tokenExpiry - 60000) {
        return accessToken;
      }

      const now = Math.floor(Date.now() / 1000);
      const assertion = signJwt(
        { alg: 'RS256', typ: 'JWT' },
        {
          iss: serviceAccount.client_email,
          scope,
          aud: GOOGLE_TOKEN_URL,
          iat: now,
          exp: now + 3600,
        },
        serviceAccount.private_key,
      );

      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(`Service-account auth failed: ${data.error_description || data.error}`);
      }

      accessToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in * 1000);

      return accessToken;
    },
  };
}

module.exports = { createTokenProvider, GOOGLE_TOKEN_URL };
