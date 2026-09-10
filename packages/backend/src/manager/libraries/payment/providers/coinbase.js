const powertools = require('node-powertools');
const fetchFailure = require('../fetch-failure.js');
const env = require('../../env.js');
const assertLicensedPayments = require('../license.js');

// Coinbase Commerce API. One base URL — there is no sandbox host: test charges
// are made on a test-mode API key against this same endpoint.
const API_URL = 'https://api.commerce.coinbase.com';

// The API version this library is written against, sent on every call. Coinbase
// pins response shapes to it, so an account defaulting to a newer version still
// answers the shape read below.
const API_VERSION = '2018-03-22';

// Charge timeline statuses → the unified one-time status. A charge's status IS
// the last entry of its timeline; there is no top-level status field.
const STATUS_MAP = {
  NEW: 'pending',
  PENDING: 'pending',
  COMPLETED: 'completed',
  // A charge that was under/over-paid or delayed goes UNRESOLVED, and a merchant
  // decision moves it to RESOLVED — money the merchant accepted, so it books the
  // same way a clean COMPLETED does.
  RESOLVED: 'completed',
  EXPIRED: 'failed',
  CANCELED: 'failed',
};

// Cached API key
let cachedApiKey = null;

/**
 * Coinbase Commerce shared library
 * Provides API helpers, resource fetching, and unified transformations
 *
 * ONE-TIME ONLY. Coinbase Commerce sells a hosted CHARGE — a single payment at a
 * single price — and has no subscription, plan or billing-agreement concept at
 * all, so nothing here ever reaches the pipeline's subscription half
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 */
const Coinbase = {
  /**
   * Initialize or return the Coinbase Commerce API key
   * @returns {string} API key
   */
  init() {
    // A keyless deploy runs no live payments (#320) — before the key, and before
    // the cache below can hand one back
    assertLicensedPayments('Coinbase Commerce');

    if (cachedApiKey) {
      return cachedApiKey;
    }

    const apiKey = env.get('COINBASE_COMMERCE_API_KEY');

    if (!apiKey) {
      throw new Error('COINBASE_COMMERCE_API_KEY environment variable is required');
    }

    cachedApiKey = apiKey;

    return cachedApiKey;
  },

  /**
   * Make an authenticated Coinbase Commerce API request
   * Auth is the API key in a header; bodies and responses are JSON, and every
   * resource comes back wrapped in a `data` key
   *
   * @param {string} endpoint - API path (e.g. '/charges/8f783fa6-…')
   * @param {object} options - { method, body (object, JSON-encoded), headers }
   * @returns {Promise<object>} Parsed JSON response
   */
  async request(endpoint, options = {}) {
    const apiKey = this.init();

    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'X-CC-Api-Key': apiKey,
        'X-CC-Version': API_VERSION,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (options.body) {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(`${API_URL}${endpoint}`, fetchOptions);

    // 204 No Content
    if (response.status === 204) {
      return {};
    }

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || data?.message || JSON.stringify(data);
      // The status rides on the error the way Chargebee's does, so the shared
      // classifier ([../provider-errors.js](../provider-errors.js)) can tell a
      // charge Coinbase does not have from one it could not answer for
      const err = new Error(`Coinbase Commerce API ${response.status}: ${msg}`);
      err.statusCode = response.status;
      throw err;
    }

    return data;
  },

  /**
   * Fetch the latest resource from Coinbase Commerce's API
   * Coinbase's answer is the only trusted source — a lookup that fails throws the
   * classified failure ([../fetch-failure.js](../fetch-failure.js)) instead of
   * degrading to the webhook payload
   *
   * @param {string} resourceType - 'charge' (the only kind Coinbase Commerce has)
   * @param {string} resourceId - Charge id or code (the endpoint takes either)
   * @param {object} context - Additional context (unused; kept for the interface)
   * @returns {object} Full charge object
   */
  async fetchResource(resourceType, resourceId, context) {
    try {
      if (resourceType === 'charge') {
        const result = await this.request(`/charges/${resourceId}`);

        return result.data || result;
      }

      throw new Error(`Unknown resource type: ${resourceType}`);
    } catch (e) {
      throw fetchFailure(e, { provider: 'coinbase', fn: 'fetchResource', resourceType, resourceId });
    }
  },

  /**
   * Extract the resource a Coinbase Commerce webhook envelope carries
   * Identifiers only — the payload never drives state ([../fetch-failure.js](../fetch-failure.js))
   *
   * @param {object} raw - Raw Coinbase Commerce webhook payload
   * @returns {object|null}
   */
  extractResource(raw) {
    return raw?.event?.data || null;
  },

  /**
   * Extract the internal orderId from a charge
   * Coinbase Commerce metadata is a flat string map we set at charge creation
   *
   * @param {object} resource - Raw charge
   * @returns {string|null}
   */
  getOrderId(resource) {
    return resource?.metadata?.orderId || null;
  },

  /**
   * Extract the UID from a charge's metadata
   *
   * @param {object} resource - Raw charge
   * @returns {string|null}
   */
  getUid(resource) {
    return resource?.metadata?.uid || null;
  },

  /**
   * What a Coinbase Commerce refund moved — nothing, ever.
   *
   * Coinbase Commerce has no refund API and publishes no refund event: returning
   * crypto is a manual transfer a merchant makes from the dashboard, and no
   * record of it is ever attached to the charge. So no coinbase event can be a
   * refund, and this is unreachable by construction — the webhook parser
   * categorizes no refund at all, and the refund route refuses a crypto order
   * before it loads a provider ([../refund-policy.js](../refund-policy.js)).
   *
   * It answers rather than throws because the caller is the webhook pipeline: an
   * exception here would fail and redeliver an event forever. It records NO
   * amount rather than the payload's, which is the same answer every provider
   * gives for an event naming no refund record.
   *
   * @param {object} resource - The charge the caller had in hand
   * @param {object} [options] - { eventType, ctx }
   * @returns {Promise<{ amount: null, currency: string, reason: null }>}
   */
  async getRefundDetails(resource, options = {}) {
    const message = `coinbase getRefundDetails(): ${options.eventType || 'an event'} was read as a refund, but Coinbase Commerce has no refund record to ask about (charge=${resource?.id || 'unknown'}) — no amount is recorded`;

    if (options.ctx?.warn) {
      options.ctx.warn(message);
    } else {
      console.warn(`[@omega.js/backend:payment:coinbase] ${message}`);
    }

    return { amount: null, currency: 'USD', reason: null };
  },

  /**
   * Transform a raw Coinbase Commerce charge into the unified one-time shape
   *
   * @param {object} rawResource - Raw charge
   * @param {object} options
   * @param {object} options.config - @omega.js/backend config (must contain products array)
   * @param {string} options.eventName - Name of the webhook event
   * @param {string} options.eventId - ID of the webhook event
   * @returns {object} Unified one-time payment object
   */
  toUnifiedOneTime(rawResource, options) {
    options = options || {};
    const config = options.config || {};

    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    const metadata = rawResource?.metadata || {};
    const productId = metadata.productId || null;
    const product = resolveProductOneTime(productId, config);
    const price = resolvePrice(productId, 'once', config);

    return {
      product: product,
      status: resolveStatus(rawResource),
      payment: {
        provider: 'coinbase',
        orderId: metadata.orderId || null,
        resourceId: rawResource?.id || null,
        price: price,
        updatedBy: {
          event: {
            name: options.eventName || null,
            id: options.eventId || null,
          },
          date: {
            timestamp: now,
            timestampUNIX: nowUNIX,
          },
        },
      },
    };
  },

  /**
   * There is no such thing as a Coinbase Commerce subscription.
   *
   * The interface asks every library for this, and answering with a fabricated
   * subscription would write one onto a user doc off a single crypto payment.
   * The webhook parser categorizes every coinbase event as one-time, so reaching
   * here means the pipeline was handed a charge as a subscription — a bug, and
   * one that must stop at the bug rather than mint access nobody bought.
   *
   * @throws {Error} always
   */
  toUnifiedSubscription() {
    throw new Error('Coinbase Commerce has no subscriptions — a crypto charge is a one-time purchase');
  },

  /**
   * Build the metadata a charge carries our identifiers in
   * Coinbase Commerce metadata is a flat map of strings, so each identifier is
   * its own key — there is no custom_id string to pack, the way PayPal needs
   *
   * @param {string} uid - User's Firebase UID
   * @param {string} orderId - Our internal order ID
   * @param {string} productId - Product ID (a coinbase charge is always one-time)
   * @returns {object}
   */
  buildMetadata(uid, orderId, productId) {
    return { uid: uid, orderId: orderId, productId: productId };
  },
};

/**
 * The unified status of a charge, read off the LAST entry of its timeline.
 *
 * A Coinbase charge has no status field: the timeline is the record, appended to
 * as the payment is detected, confirmed, or expires. An unmapped status passes
 * through lowercased, the way the other providers pass their own words through —
 * inventing `failed` for a word we do not know would revoke a purchase that may
 * be fine.
 *
 * @param {object} raw - Raw charge
 * @returns {string}
 */
function resolveStatus(raw) {
  const timeline = Array.isArray(raw?.timeline) ? raw.timeline : [];
  const latest = timeline[timeline.length - 1];
  const status = latest?.status;

  if (!status) {
    return 'unknown';
  }

  return STATUS_MAP[status] || String(status).toLowerCase();
}

/**
 * Resolve product for one-time payments
 */
function resolveProductOneTime(productId, config) {
  if (!productId || !config.payment?.products) {
    return { id: productId || 'unknown', name: 'Unknown' };
  }

  const product = config.payment.products.find(p => p.id === productId);

  if (!product) {
    return { id: productId, name: productId };
  }

  return { id: product.id, name: product.name || product.id };
}

/**
 * Resolve the display price for a product/frequency from config
 */
function resolvePrice(productId, frequency, config) {
  const product = config.payment?.products?.find(p => p.id === productId);

  if (!product || !product.prices) {
    return 0;
  }

  return product.prices[frequency] || 0;
}

module.exports = Coinbase;
