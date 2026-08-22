/**
 * Cloudflare API client — omega-manager's fetch wrapper, ported verbatim.
 * Token comes from CLOUDFLARE_TOKEN in the brand .env (loaded before services
 * run) or is passed in directly.
 */

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

class CloudflareAPI {
  constructor(apiToken = null) {
    this.apiToken = apiToken || process.env.CLOUDFLARE_TOKEN;

    if (!this.apiToken) {
      throw new Error('Cloudflare API token not configured. Set CLOUDFLARE_TOKEN in the brand .env');
    }

    this.headers = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${CLOUDFLARE_API_BASE}${endpoint}`;

    // FormData bodies (worker uploads) must not carry a JSON Content-Type —
    // fetch sets the multipart boundary itself
    const isFormData = options.body instanceof FormData;
    const headers = isFormData
      ? { 'Authorization': `Bearer ${this.apiToken}`, ...options.headers }
      : { ...this.headers, ...options.headers };

    const response = await fetch(url, { ...options, headers });
    const data = await response.json();

    if (!data.success) {
      throw new Error(`Cloudflare API Error: ${JSON.stringify(data.errors)}`);
    }

    return data;
  }

  /**
   * Find a zone by its exact name (null if not found)
   */
  async getZoneByName(domain) {
    const data = await this.makeRequest(`/zones?name=${domain}`);

    if (!data.result || data.result.length === 0) {
      return null;
    }

    return data.result[0];
  }

  /**
   * List every zone on the account (paginated)
   */
  async getAllZones() {
    const zones = [];
    let page = 1;
    const perPage = 50;

    while (true) {
      const data = await this.makeRequest(`/zones?page=${page}&per_page=${perPage}`);

      if (!data.result || data.result.length === 0) {
        break;
      }

      zones.push(...data.result);

      if (data.result.length < perPage) {
        break;
      }

      page++;
    }

    return zones;
  }
}

module.exports = { CloudflareAPI };
