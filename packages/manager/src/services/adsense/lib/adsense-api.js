/**
 * Google AdSense Management API v2 client — read-only by design (the API has
 * no site-management writes at all; the `adsense.readonly` scope makes that
 * explicit). Named-method surface over the shared GoogleOAuth2Client so
 * tests can fake it method-for-method.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env; tokens
 * cache separately from the other Google services' (different scope).
 */
const { GoogleOAuth2Client } = require('../../../lib/google-auth.js');

const ADSENSE_API_BASE = 'https://adsense.googleapis.com/v2';

const SCOPES = [
  'https://www.googleapis.com/auth/adsense.readonly',
];

class GoogleAdsenseAPI {
  constructor(options = {}) {
    this.auth = new GoogleOAuth2Client({
      clientId: options.clientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: options.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
      tokenStorePath: options.tokenStorePath,
      scopes: SCOPES,
    });
  }

  async makeRequest(endpoint, options = {}) {
    return this.auth.makeRequest(`${ADSENSE_API_BASE}${endpoint}`, options);
  }

  /** accountId: 'pub-…' (the accounts/ prefix already stripped) */
  async listSites(accountId) {
    const data = await this.makeRequest(`/accounts/${accountId}/sites`);
    return data.sites || [];
  }
}

module.exports = { GoogleAdsenseAPI };
