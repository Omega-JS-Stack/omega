/**
 * Meta Marketing API client (Graph API) — the ad account's pixels/datasets.
 * Named-method surface over fetch so tests can fake it method-for-method,
 * normalized to the shared pixel shape ({ id, name }) the provisioning flow
 * consumes (lib/pixel-provision.js).
 *
 * Auth: META_ACCESS_TOKEN in the brand .env — a Business Manager SYSTEM-USER
 * token with ads_management on the ad account. ONE Meta token per brand: the
 * same key @omega.js/backend's Conversions API sender reads, on the same
 * Graph API version.
 */
const META_API_VERSION = 'v21.0'; // matches @omega.js/backend's conversions sender
const API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Ad-account ids are configured BARE (the number Ads Manager shows); the
 * Graph edge is `act_<id>`, and a value pasted with the prefix still works.
 */
function adAccountRef(adAccountId) {
  const id = String(adAccountId);
  return id.startsWith('act_') ? id : `act_${id}`;
}

class MetaMarketingAPI {
  constructor(options = {}) {
    // Null unless passed explicitly: the env is read at REQUEST time, because
    // an interactive run pastes META_ACCESS_TOKEN after this client was built
    this.accessToken = options.accessToken || null;
  }

  async makeRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken || process.env.META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      // Graph errors are { error: { message, type, code } } and the message
      // is the human half ("(#200) Requires ads_management permission")
      throw new Error(`Meta API error (${response.status}): ${data?.error?.message || response.statusText}`);
    }

    return data;
  }

  /**
   * Ad accounts this token can act on — the auto-discovery source (#417).
   * `id` comes back as `act_<number>` and `account_id` as the bare number
   * config carries, so the normalized id is the one a human reads in Ads
   * Manager.
   */
  async listAdAccounts() {
    const data = await this.makeRequest('/me/adaccounts?fields=id,name,account_id&limit=100');
    return (data?.data || []).map((account) => ({
      id: account.account_id || String(account.id).replace(/^act_/, ''),
      name: account.name,
    }));
  }

  /** Pixels on the ad account — id + name only (name is the match key). */
  async listPixels(adAccountId) {
    const data = await this.makeRequest(`/${adAccountRef(adAccountId)}/adspixels?fields=id,name&limit=100`);
    return (data?.data || []).map((pixel) => ({ id: pixel.id, name: pixel.name }));
  }

  /** Create a pixel/dataset on the ad account (the create echoes id only). */
  async createPixel(adAccountId, name) {
    const created = await this.makeRequest(`/${adAccountRef(adAccountId)}/adspixels`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return { id: created?.id, name };
  }
}

module.exports = { MetaMarketingAPI };
