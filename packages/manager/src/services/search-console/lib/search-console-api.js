/**
 * Google Search Console client — the Webmasters v3 API (sites + sitemaps)
 * plus the Site Verification v1 API (DNS_TXT domain verification). Named-
 * method surface over the shared GoogleOAuth2Client so tests can fake it
 * method-for-method.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env; tokens
 * cache separately from the firebase/analytics services' (different scopes).
 */
const { GoogleOAuth2Client } = require('../../../lib/google-auth.js');

const SEARCH_CONSOLE_API_BASE = 'https://www.googleapis.com/webmasters/v3';
const SITE_VERIFICATION_API_BASE = 'https://www.googleapis.com/siteVerification/v1';

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
];

class GoogleSearchConsoleAPI {
  constructor(options = {}) {
    this.auth = new GoogleOAuth2Client({
      clientId: options.clientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: options.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
      tokenStorePath: options.tokenStorePath,
      scopes: SCOPES,
    });
  }

  async makeRequest(endpoint, options = {}) {
    return this.auth.makeRequest(`${SEARCH_CONSOLE_API_BASE}${endpoint}`, options);
  }

  // ========== Sites ==========

  async listSites() {
    const data = await this.makeRequest('/sites');
    return data.siteEntry || [];
  }

  /** siteUrl: 'https://example.com/' or 'sc-domain:example.com' */
  async addSite(siteUrl) {
    await this.makeRequest(`/sites/${encodeURIComponent(siteUrl)}`, { method: 'PUT' });
    return { added: true, siteUrl };
  }

  // ========== Sitemaps ==========

  async listSitemaps(siteUrl) {
    const data = await this.makeRequest(`/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
    return data.sitemap || [];
  }

  async submitSitemap(siteUrl, sitemapUrl) {
    await this.makeRequest(
      `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      { method: 'PUT' },
    );
    return { submitted: true, siteUrl, sitemapUrl };
  }

  // ========== Site Verification ==========

  async makeVerificationRequest(endpoint, options = {}) {
    return this.auth.makeRequest(`${SITE_VERIFICATION_API_BASE}${endpoint}`, options);
  }

  /**
   * Get the verification token for a site. Idempotent — the same token comes
   * back for the same site+method until it's used.
   *
   * @param {string} identifier - Domain (INET_DOMAIN) or URL (SITE)
   * @param {string} verificationMethod - 'DNS_TXT' | 'DNS_CNAME' | 'FILE' | 'META'
   * @param {string} type - 'INET_DOMAIN' (domain property) | 'SITE' (URL prefix)
   */
  async getVerificationToken(identifier, verificationMethod = 'DNS_TXT', type = 'INET_DOMAIN') {
    return await this.makeVerificationRequest('/token', {
      method: 'POST',
      body: JSON.stringify({
        site: { type, identifier },
        verificationMethod,
      }),
    });
  }

  /** Claim ownership once the token is in place (method goes in the query). */
  async verifySite(identifier, verificationMethod = 'DNS_TXT', type = 'INET_DOMAIN') {
    return await this.makeVerificationRequest(`/webResource?verificationMethod=${verificationMethod}`, {
      method: 'POST',
      body: JSON.stringify({
        site: { type, identifier },
      }),
    });
  }
}

module.exports = { GoogleSearchConsoleAPI };
