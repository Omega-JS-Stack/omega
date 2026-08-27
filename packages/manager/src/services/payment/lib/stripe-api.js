/**
 * Stripe API wrapper — the official SDK behind the method surface the
 * payment operations actually use (accounts, products, prices, webhook
 * endpoints). omega-manager's wrapper also carried test clocks, customers,
 * subscriptions, and Radar-rule methods; the first three ride the
 * testing-live port and the Radar methods were dead code (Stripe has no
 * Radar rules API — the stripe-radar operation is manual guidance).
 */
const Stripe = require('stripe');

class StripeAPI {
  constructor(secretKey) {
    this.stripe = new Stripe(secretKey);
  }

  /**
   * Retrieve the current Stripe account
   */
  async getAccount() {
    return this.stripe.accounts.retrieve();
  }

  /**
   * Update a Stripe account's settings
   */
  async updateAccount(accountId, updates) {
    return this.stripe.accounts.update(accountId, updates);
  }

  /**
   * Retrieve a product by ID
   */
  async getProduct(productId) {
    return this.stripe.products.retrieve(productId);
  }

  /**
   * Create a Stripe product with full brand/product details
   */
  async createProduct({ name, brandId, productId, description, images, url }) {
    const params = {
      name,
      metadata: { brandId, productId },
    };

    if (description) {
      params.description = description;
    }
    if (images?.length) {
      params.images = images;
    }
    if (url) {
      params.url = url;
    }

    return this.stripe.products.create(params);
  }

  /**
   * Update an existing Stripe product
   */
  async updateProduct(stripeProductId, updates) {
    return this.stripe.products.update(stripeProductId, updates);
  }

  /**
   * List all products (auto-paginates)
   */
  async listAllProducts() {
    const products = [];
    for await (const product of this.stripe.products.list({ limit: 100 })) {
      products.push(product);
    }
    return products;
  }

  /**
   * List all prices for a product (auto-paginates)
   */
  async listPricesForProduct(productId) {
    const prices = [];
    for await (const price of this.stripe.prices.list({ product: productId, limit: 100 })) {
      prices.push(price);
    }
    return prices;
  }

  /**
   * Create a recurring price (monthly or annually)
   */
  async createRecurringPrice(productId, amount, interval, currency = 'usd') {
    return this.stripe.prices.create({
      product: productId,
      unit_amount: Math.round(amount * 100), // Stripe uses cents
      currency,
      recurring: {
        interval: { annually: 'year', monthly: 'month', weekly: 'week', daily: 'day' }[interval] || 'month',
      },
    });
  }

  /**
   * Create a one-time price
   */
  async createOneTimePrice(productId, amount, currency = 'usd') {
    return this.stripe.prices.create({
      product: productId,
      unit_amount: Math.round(amount * 100),
      currency,
    });
  }

  /**
   * Archive a price (set active: false). Stripe does not support deleting prices.
   */
  async archivePrice(priceId) {
    return this.stripe.prices.update(priceId, { active: false });
  }

  /**
   * List all webhook endpoints on this account
   */
  async listWebhookEndpoints() {
    return this.stripe.webhookEndpoints.list({ limit: 100 });
  }

  /**
   * Create a webhook endpoint
   */
  async createWebhookEndpoint(url, enabledEvents) {
    return this.stripe.webhookEndpoints.create({
      url,
      enabled_events: enabledEvents,
    });
  }

  /**
   * Update a webhook endpoint ({ enabled_events }, { disabled }, etc.)
   */
  async updateWebhookEndpoint(webhookId, params) {
    return this.stripe.webhookEndpoints.update(webhookId, params);
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhookEndpoint(webhookId) {
    return this.stripe.webhookEndpoints.del(webhookId);
  }
}

module.exports = { StripeAPI };
