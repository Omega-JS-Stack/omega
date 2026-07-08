/**
 * Beehiiv v2 API client — publications, custom fields, segments (list-only;
 * Beehiiv has no segment-create API), and per-publication webhooks. Named-
 * method surface so tests can fake it method-for-method.
 *
 * Auth: BEEHIIV_API_KEY in the brand .env.
 */
const BEEHIIV_API_BASE = 'https://api.beehiiv.com/v2';

class BeehiivAPI {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.BEEHIIV_API_KEY;
  }

  async makeRequest(endpoint, options = {}) {
    const response = await fetch(`${BEEHIIV_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 204) {
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      const message = data.message || data.error || response.statusText;
      throw new Error(`Beehiiv API error (${response.status}): ${message}`);
    }

    return data;
  }

  /** Fetch every page of a paginated collection endpoint. */
  async getAllPages(basePath) {
    const all = [];
    let page = 1;

    while (true) {
      const data = await this.makeRequest(`${basePath}?page=${page}&limit=100`);
      all.push(...(data.data || []));

      if (page >= (data.total_pages || 1)) {
        break;
      }
      page += 1;
    }

    return all;
  }

  // ========== Publications ==========

  async getPublication(publicationId) {
    try {
      const data = await this.makeRequest(`/publications/${publicationId}`);
      return data.data;
    } catch (error) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  async listPublications() {
    const data = await this.makeRequest('/publications');
    return data.data || [];
  }

  // ========== Custom fields ==========

  async getCustomFields(publicationId) {
    return this.getAllPages(`/publications/${publicationId}/custom_fields`);
  }

  /** kind: 'string' | 'integer' | 'boolean' | 'datetime' */
  async createCustomField(publicationId, name, display, kind) {
    return this.makeRequest(`/publications/${publicationId}/custom_fields`, {
      method: 'POST',
      body: JSON.stringify({ name, display, kind }),
    });
  }

  async deleteCustomField(publicationId, fieldId) {
    return this.makeRequest(`/publications/${publicationId}/custom_fields/${fieldId}`, {
      method: 'DELETE',
    });
  }

  // ========== Segments (list-only — Beehiiv has no create API) ==========

  async getSegments(publicationId) {
    return this.getAllPages(`/publications/${publicationId}/segments`);
  }

  // ========== Webhooks (per-publication) ==========

  async listWebhooks(publicationId) {
    return this.getAllPages(`/publications/${publicationId}/webhooks`);
  }

  /** payload: { url, event_types[], description?, http_method? } */
  async createWebhook(publicationId, payload) {
    return this.makeRequest(`/publications/${publicationId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateWebhook(publicationId, webhookId, payload) {
    return this.makeRequest(`/publications/${publicationId}/webhooks/${webhookId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }
}

module.exports = { BeehiivAPI };
