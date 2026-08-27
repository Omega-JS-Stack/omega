/**
 * Chargebee REST API wrapper — HTTP Basic Auth with the API key as username,
 * form-encoded POST bodies, JSON responses wrapped in a type key (e.g.
 * { item: { ... } }). Ported from omega-manager minus the subscription
 * inspection and unused price/plan helpers (they belong to the migrations
 * port).
 */
class ChargebeeAPI {
  constructor(site, apiKey) {
    this.site = site;
    this.baseUrl = `https://${site}.chargebee.com/api/v2`;
    this.authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  }

  /**
   * Make an authenticated request to Chargebee API.
   *
   * @param {string} method - HTTP method
   * @param {string} path - API path (e.g. '/items/my-item')
   * @param {Object} [params] - Query params (GET) or form body (POST)
   * @returns {Object} Parsed JSON response
   */
  async makeRequest(method, path, params = {}) {
    const options = {
      method,
      headers: { 'Authorization': this.authHeader },
    };

    let url = `${this.baseUrl}${path}`;

    // Flatten nested params for form encoding: { a: { b: 'c' } } → 'a[b]=c'
    const flat = flattenParams(params);

    if (method === 'GET') {
      const qs = new URLSearchParams(flat).toString();
      if (qs) {
        url += `?${qs}`;
      }
    } else {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(flat).toString();
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Chargebee API error (${response.status} ${method} ${path}): ${text}`);
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * Paginate through a Chargebee list endpoint, collecting all items.
   *
   * Chargebee returns { list: [ { item: {...} }, ... ], next_offset: '...' }
   * The unwrapKey extracts the inner object from each list entry.
   *
   * @param {string} path - API path (e.g. '/items')
   * @param {string} unwrapKey - Key to unwrap from each list entry (e.g. 'item')
   * @param {Object} [params] - Additional query params (filters, etc.)
   * @returns {Array} All unwrapped items across all pages
   */
  async paginate(path, unwrapKey, params = {}) {
    const allItems = [];
    let offset;

    while (true) {
      const queryParams = { ...params, 'limit': 100 };
      if (offset) {
        queryParams.offset = offset;
      }

      const response = await this.makeRequest('GET', path, queryParams);
      const entries = response?.list || [];

      for (const entry of entries) {
        allItems.push(unwrapKey ? entry[unwrapKey] : entry);
      }

      offset = response?.next_offset;
      if (!offset || entries.length === 0) {
        break;
      }
    }

    return allItems;
  }

  // ---------------------------------------------------------------------------
  // Item Families
  // ---------------------------------------------------------------------------

  /**
   * Get an item family by ID
   */
  async getItemFamily(familyId) {
    const data = await this.makeRequest('GET', `/item_families/${familyId}`);
    return data?.item_family;
  }

  /**
   * Create an item family
   */
  async createItemFamily({ id, name, description }) {
    const params = { id, name };
    if (description) {
      params.description = description;
    }
    const data = await this.makeRequest('POST', '/item_families', params);
    return data?.item_family;
  }

  /**
   * Update an item family
   */
  async updateItemFamily(familyId, updates) {
    const data = await this.makeRequest('POST', `/item_families/${familyId}`, updates);
    return data?.item_family;
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  /**
   * Get an item by ID
   */
  async getItem(itemId) {
    const data = await this.makeRequest('GET', `/items/${itemId}`);
    return data?.item;
  }

  /**
   * Create an item
   *
   * @param {Object} options
   * @param {string} options.id - Custom item ID (e.g. 'somiibo-plus')
   * @param {string} options.name - Display name
   * @param {string} options.type - 'plan' | 'addon' | 'charge'
   * @param {string} options.itemFamilyId - Parent item family ID
   * @param {string} [options.description] - Item description
   */
  async createItem({ id, name, type, itemFamilyId, description, externalName, redirectUrl, metadata }) {
    const params = {
      id,
      name,
      type,
      item_family_id: itemFamilyId,
    };
    if (description) {
      params.description = description;
    }
    if (externalName) {
      params.external_name = externalName;
    }
    if (redirectUrl) {
      params.redirect_url = redirectUrl;
    }
    if (metadata) {
      params.metadata = JSON.stringify(metadata);
    }
    const data = await this.makeRequest('POST', '/items', params);
    return data?.item;
  }

  /**
   * Update an item
   */
  async updateItem(itemId, updates) {
    const data = await this.makeRequest('POST', `/items/${itemId}`, updates);
    return data?.item;
  }

  // ---------------------------------------------------------------------------
  // Item Prices
  // ---------------------------------------------------------------------------

  /**
   * List item prices for a specific item (paginated)
   */
  async listItemPricesForItem(itemId) {
    return this.paginate('/item_prices', 'item_price', {
      'item_id[is]': itemId,
    });
  }

  /**
   * Create an item price
   *
   * @param {Object} options
   * @param {string} options.id - Custom price ID (e.g. 'somiibo-plus-monthly')
   * @param {string} options.itemId - Parent item ID
   * @param {string} options.name - Display name
   * @param {string} options.pricingModel - 'flat_fee' | 'per_unit' | etc.
   * @param {number} options.price - Price in cents
   * @param {number} [options.period] - Billing period count (e.g. 1)
   * @param {string} [options.periodUnit] - 'month' | 'year' | 'week' | 'day'
   * @param {number} [options.trialPeriod] - Trial period count
   * @param {string} [options.trialPeriodUnit] - 'day' | 'month'
   * @param {string} [options.currencyCode] - Currency (default: 'USD')
   * @param {string} [options.externalName] - Customer-facing name
   */
  async createItemPrice({ id, itemId, name, pricingModel = 'flat_fee', price, period, periodUnit, trialPeriod, trialPeriodUnit, currencyCode = 'USD', externalName }) {
    const params = {
      id,
      item_id: itemId,
      name,
      pricing_model: pricingModel,
      price,
      currency_code: currencyCode,
    };

    if (period) {
      params.period = period;
    }
    if (periodUnit) {
      params.period_unit = periodUnit;
    }
    if (trialPeriod) {
      params.trial_period = trialPeriod;
    }
    if (trialPeriodUnit) {
      params.trial_period_unit = trialPeriodUnit;
    }
    if (externalName) {
      params.external_name = externalName;
    }

    const data = await this.makeRequest('POST', '/item_prices', params);
    return data?.item_price;
  }

  /**
   * Update an item price
   */
  async updateItemPrice(itemPriceId, updates) {
    const data = await this.makeRequest('POST', `/item_prices/${itemPriceId}`, updates);
    return data?.item_price;
  }

  // ---------------------------------------------------------------------------
  // Legacy Plans (read-only — for reporting existing plan-model data)
  // ---------------------------------------------------------------------------

  /**
   * Get a plan by ID
   */
  async getPlan(planId) {
    const data = await this.makeRequest('GET', `/plans/${planId}`);
    return data?.plan;
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * List all webhook endpoints
   */
  async listWebhooks() {
    return this.paginate('/webhook_endpoints', 'webhook_endpoint');
  }

  /**
   * Create a webhook endpoint
   *
   * @param {Object} options
   * @param {string} options.url - Webhook URL
   * @param {string} [options.name] - Display name
   * @param {string[]} [options.eventTypes] - Array of event type names
   */
  async createWebhook({ url, name, eventTypes }) {
    const params = { url };
    if (name) {
      params.name = name;
    }
    if (eventTypes?.length) {
      // Chargebee expects enabled_events as JSON array string
      params.enabled_events = JSON.stringify(eventTypes);
    }
    const data = await this.makeRequest('POST', '/webhook_endpoints', params);
    return data?.webhook_endpoint;
  }

  /**
   * Update a webhook endpoint
   */
  async updateWebhook(webhookId, updates) {
    const data = await this.makeRequest('POST', `/webhook_endpoints/${webhookId}`, updates);
    return data?.webhook_endpoint;
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhook(webhookId) {
    const data = await this.makeRequest('POST', `/webhook_endpoints/${webhookId}/delete`);
    return data?.webhook_endpoint;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten nested object for form-encoding.
 * { a: { b: 'c' } } → { 'a[b]': 'c' }
 * Handles one level of nesting (Chargebee's convention).
 */
function flattenParams(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) {
      continue;
    }

    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenParams(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

module.exports = { ChargebeeAPI };
