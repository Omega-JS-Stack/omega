/**
 * PayPal REST API wrapper — OAuth2 client credentials with live/sandbox
 * auto-detection (first auth probes both endpoints in parallel). Ported from
 * omega-manager minus the subscription-inspection methods (they belong to
 * the migrations port) and the unused plan/webhook helpers.
 */
const LIVE_URL = 'https://api-m.paypal.com';
const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';

class PayPalAPI {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = null; // Resolved on first auth
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.appId = null; // From token response
  }

  /**
   * Try to authenticate against a specific PayPal endpoint.
   * Returns the token response data on success, null on auth failure.
   */
  static async tryAuth(clientId, clientSecret, baseUrl) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  /**
   * Get OAuth2 access token (cached until expiry).
   * On first call, tries both live and sandbox simultaneously to detect the right endpoint.
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // First auth — try both endpoints in parallel
    if (!this.baseUrl) {
      const [liveResult, sandboxResult] = await Promise.all([
        PayPalAPI.tryAuth(this.clientId, this.clientSecret, LIVE_URL),
        PayPalAPI.tryAuth(this.clientId, this.clientSecret, SANDBOX_URL),
      ]);

      if (liveResult) {
        this._applyToken(liveResult, LIVE_URL);
        return this.accessToken;
      }

      if (sandboxResult) {
        this._applyToken(sandboxResult, SANDBOX_URL);
        return this.accessToken;
      }

      throw new Error('PayPal auth failed on both live and sandbox — check paypal.clientId and PAYPAL_CLIENT_SECRET');
    }

    // Subsequent auths — use the resolved endpoint
    const result = await PayPalAPI.tryAuth(this.clientId, this.clientSecret, this.baseUrl);
    if (!result) {
      throw new Error(`PayPal auth failed (${this.baseUrl})`);
    }

    this._applyToken(result);
    return this.accessToken;
  }

  /**
   * Store token data from an auth response
   */
  _applyToken(data, baseUrl) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    this.appId = data.app_id || this.appId;
  }

  /**
   * Get account info derived from the token response.
   * Must call getAccessToken() first.
   */
  getAccountInfo() {
    return {
      appId: this.appId,
      environment: this.baseUrl === SANDBOX_URL ? 'sandbox' : 'live',
      clientId: this.clientId,
    };
  }

  /**
   * Make an authenticated request to PayPal API
   */
  async makeRequest(method, path, body, extraHeaders) {
    const token = await this.getAccessToken();

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });

    // PATCH returns 204 No Content on success
    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PayPal API error (${response.status} ${method} ${path}): ${text}`);
    }

    return response.json();
  }

  /**
   * Paginate through a PayPal list endpoint, collecting all items.
   *
   * @param {string} basePath - Base API path (e.g. '/v1/catalogs/products')
   * @param {string} itemsKey - Key in response containing items (e.g. 'products')
   * @param {Object} [extraParams] - Additional query params
   * @param {Object} [extraHeaders] - Additional request headers
   * @returns {Array} All items across all pages
   */
  async paginate(basePath, itemsKey, extraParams = {}, extraHeaders) {
    const allItems = [];
    let page = 1;
    const pageSize = 20;

    while (true) {
      const params = new URLSearchParams({
        page_size: pageSize,
        page: page,
        total_required: true,
        ...extraParams,
      });

      const response = await this.makeRequest('GET', `${basePath}?${params}`, null, extraHeaders);
      const items = response?.[itemsKey] || [];
      allItems.push(...items);

      const total = response?.total_items || 0;
      if (allItems.length >= total || items.length < pageSize) {
        break;
      }

      page++;
    }

    return allItems;
  }

  // ---------------------------------------------------------------------------
  // Catalog Products
  // ---------------------------------------------------------------------------

  /**
   * List all catalog products (paginated)
   */
  async listProducts() {
    return this.paginate('/v1/catalogs/products', 'products');
  }

  /**
   * Retrieve a catalog product by ID
   */
  async getProduct(productId) {
    return this.makeRequest('GET', `/v1/catalogs/products/${productId}`);
  }

  /**
   * Create a catalog product
   */
  async createProduct({ name, description, type = 'SERVICE', imageUrl, homeUrl }) {
    const body = {
      name,
      type,
    };

    if (description) {
      body.description = description.slice(0, 256); // PayPal limit
    }
    if (imageUrl) {
      body.image_url = imageUrl;
    }
    if (homeUrl) {
      body.home_url = homeUrl;
    }

    return this.makeRequest('POST', '/v1/catalogs/products', body);
  }

  /**
   * Update a catalog product using JSON Patch format
   *
   * @param {string} productId - PayPal product ID
   * @param {Array} patches - Array of JSON Patch operations
   *   e.g. [{ op: 'replace', path: '/description', value: 'new desc' }]
   */
  async updateProduct(productId, patches) {
    return this.makeRequest('PATCH', `/v1/catalogs/products/${productId}`, patches);
  }

  // ---------------------------------------------------------------------------
  // Billing Plans (subscriptions)
  // ---------------------------------------------------------------------------

  /**
   * List billing plans filtered by product ID (with full details including billing_cycles).
   * Paginated — returns ALL plans for the product.
   */
  async listPlansForProduct(productId) {
    return this.paginate(
      '/v1/billing/plans',
      'plans',
      { product_id: productId },
      { 'Prefer': 'return=representation' },
    );
  }

  /**
   * Deactivate a billing plan (stops new subscriptions, existing ones continue)
   */
  async deactivatePlan(planId) {
    return this.makeRequest('POST', `/v1/billing/plans/${planId}/deactivate`);
  }

  /**
   * Create a billing plan for a product
   *
   * @param {Object} options
   * @param {string} options.productId - PayPal catalog product ID
   * @param {string} options.name - Plan name (e.g. "Chatsy - Plus (Monthly)")
   * @param {string} options.interval - 'monthly' or 'annually'
   * @param {number} options.amount - Price amount (e.g. 28)
   * @param {string} [options.currency='USD'] - Currency code
   * @param {number} [options.trialDays=0] - Trial period in days
   */
  async createPlan({ productId, name, interval, amount, currency = 'USD', trialDays = 0 }) {
    const billingCycles = [];

    // Add trial cycle if specified
    if (trialDays > 0) {
      billingCycles.push({
        frequency: {
          interval_unit: 'DAY',
          interval_count: 1,
        },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: trialDays,
        pricing_scheme: {
          fixed_price: {
            value: '0',
            currency_code: currency,
          },
        },
      });
    }

    // Regular billing cycle
    billingCycles.push({
      frequency: {
        interval_unit: { annually: 'YEAR', monthly: 'MONTH', weekly: 'WEEK', daily: 'DAY' }[interval] || 'MONTH',
        interval_count: 1,
      },
      tenure_type: 'REGULAR',
      sequence: trialDays > 0 ? 2 : 1,
      total_cycles: 0, // 0 = infinite
      pricing_scheme: {
        fixed_price: {
          value: amount.toFixed(2),
          currency_code: currency,
        },
      },
    });

    const body = {
      product_id: productId,
      name,
      billing_cycles: billingCycles,
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    };

    return this.makeRequest('POST', '/v1/billing/plans', body);
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * List all webhook endpoints
   */
  async listWebhooks() {
    return this.makeRequest('GET', '/v1/notifications/webhooks');
  }

  /**
   * Create a webhook endpoint
   */
  async createWebhook(url, eventTypes) {
    return this.makeRequest('POST', '/v1/notifications/webhooks', {
      url,
      event_types: eventTypes.map((name) => ({ name })),
    });
  }

  /**
   * Update a webhook endpoint using JSON Patch format
   */
  async updateWebhook(webhookId, patches) {
    return this.makeRequest('PATCH', `/v1/notifications/webhooks/${webhookId}`, patches);
  }
}

module.exports = { PayPalAPI };
