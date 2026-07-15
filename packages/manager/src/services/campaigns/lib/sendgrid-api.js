/**
 * SendGrid v3 API client — marketing (lists, custom fields, segments),
 * verified senders, domain authentication, and the account-global Event
 * Webhook. Named-method surface so tests can fake it method-for-method.
 *
 * Auth: SENDGRID_API_KEY in the brand .env.
 */
const SENDGRID_API_BASE = 'https://api.sendgrid.com/v3';

class SendGridAPI {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.SENDGRID_API_KEY;
  }

  async makeRequest(endpoint, options = {}) {
    const response = await fetch(`${SENDGRID_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // 204 No Content / 202 Accepted come back bodyless
    if (response.status === 204 || response.status === 202) {
      return null;
    }

    const text = await response.text();
    if (!text) {
      if (!response.ok) {
        throw new Error(`SendGrid API error (${response.status}): ${response.statusText}`);
      }
      return null;
    }

    const data = JSON.parse(text);

    if (!response.ok) {
      const message = data.errors?.map((e) => e.message).join(', ')
        || data.message
        || data.error
        || response.statusText;
      throw new Error(`SendGrid API error (${response.status}): ${message}`);
    }

    return data;
  }

  // ========== Marketing lists ==========

  /** All marketing lists (paginated). */
  async getLists() {
    const allLists = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (pageToken) {
        params.set('page_token', pageToken);
      }

      const data = await this.makeRequest(`/marketing/lists?${params}`);
      allLists.push(...(data.result || []));
      pageToken = data._metadata?.next;
    } while (pageToken);

    return allLists;
  }

  async getListByName(name) {
    const lists = await this.getLists();
    return lists.find((list) => list.name === name);
  }

  async getList(listId) {
    try {
      return await this.makeRequest(`/marketing/lists/${listId}`);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createList(name) {
    return this.makeRequest('/marketing/lists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  // ========== Custom fields ==========

  async getCustomFields() {
    const data = await this.makeRequest('/marketing/field_definitions');
    return data.custom_fields || [];
  }

  /** fieldType: 'Text' | 'Number' | 'Date' */
  async createCustomField(name, fieldType) {
    return this.makeRequest('/marketing/field_definitions', {
      method: 'POST',
      body: JSON.stringify({ name, field_type: fieldType }),
    });
  }

  async deleteCustomField(fieldId) {
    await this.makeRequest(`/marketing/field_definitions/${fieldId}`, {
      method: 'DELETE',
    });
  }

  // ========== Segments (v2 API) ==========

  /** All segments (paginated). The list endpoint omits query_dsl — use getSegment for detail. */
  async getSegments() {
    const allSegments = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({ page_size: '50' });
      if (pageToken) {
        params.set('page_token', pageToken);
      }

      const data = await this.makeRequest(`/marketing/segments/2.0?${params}`);
      allSegments.push(...(data.results || []));
      pageToken = data._metadata?.next;
    } while (pageToken);

    return allSegments;
  }

  async getSegment(segmentId) {
    return this.makeRequest(`/marketing/segments/2.0/${segmentId}`);
  }

  async createSegment(name, queryDsl) {
    return this.makeRequest('/marketing/segments/2.0', {
      method: 'POST',
      body: JSON.stringify({ name, query_dsl: queryDsl }),
    });
  }

  async updateSegment(segmentId, name, queryDsl) {
    return this.makeRequest(`/marketing/segments/2.0/${segmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, query_dsl: queryDsl }),
    });
  }

  async deleteSegment(segmentId) {
    await this.makeRequest(`/marketing/segments/2.0/${segmentId}`, {
      method: 'DELETE',
    });
  }

  // ========== Verified senders ==========

  async getVerifiedSenders() {
    const data = await this.makeRequest('/verified_senders');
    return data?.results || [];
  }

  /**
   * Create a verified sender. Auto-verifies when domain authentication is
   * valid (the domain-auth operation runs first for exactly that reason).
   *
   * @param {Object} sender - { nickname, fromEmail, fromName, replyToEmail, replyToName, address }
   *   address: { street, street2, city, state, zip, country } (CAN-SPAM requires it)
   */
  async createVerifiedSender({ nickname, fromEmail, fromName, replyToEmail, replyToName, address }) {
    return this.makeRequest('/verified_senders', {
      method: 'POST',
      body: JSON.stringify({
        nickname,
        from_email: fromEmail,
        from_name: fromName,
        reply_to: replyToEmail,
        reply_to_name: replyToName,
        address: address.street,
        address2: address.street2 || '',
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: address.country,
      }),
    });
  }

  async deleteVerifiedSender(senderId) {
    await this.makeRequest(`/verified_senders/${senderId}`, {
      method: 'DELETE',
    });
  }

  // ========== Domain authentication ==========

  async getAuthenticatedDomains() {
    return this.makeRequest('/whitelabel/domains');
  }

  /** Creates the DKIM/SPF record set (automatic_security → 3 CNAMEs). */
  async authenticateDomain(domain, subdomain = 'emailauth') {
    return this.makeRequest('/whitelabel/domains', {
      method: 'POST',
      body: JSON.stringify({
        domain,
        subdomain,
        automatic_security: true,
        custom_spf: false,
      }),
    });
  }

  /** Asks SendGrid to check the DNS records for a domain authentication. */
  async validateDomain(domainId) {
    return this.makeRequest(`/whitelabel/domains/${domainId}/validate`, {
      method: 'POST',
    });
  }

  // ========== Event Webhook (account-global) ==========

  async getEventWebhookSettings() {
    return this.makeRequest('/user/webhooks/event/settings');
  }

  async updateEventWebhookSettings(settings) {
    return this.makeRequest('/user/webhooks/event/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }
}

module.exports = { SendGridAPI };
