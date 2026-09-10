const powertools = require('node-powertools');
const fetchFailure = require('../fetch-failure.js');
const assertRefundLinkage = require('../refund-linkage.js');
const env = require('../../env.js');
const assertLicensedPayments = require('../license.js');

// Epoch zero timestamps (used as default/empty dates)
const EPOCH_ZERO = powertools.timestamp(new Date(0), { output: 'string' });
const EPOCH_ZERO_UNIX = powertools.timestamp(EPOCH_ZERO, { output: 'unix' });

// PayPal interval → unified frequency map
const INTERVAL_TO_FREQUENCY = { YEAR: 'annually', MONTH: 'monthly', WEEK: 'weekly', DAY: 'daily' };
const FREQUENCY_TO_INTERVAL = { annually: 'YEAR', monthly: 'MONTH', weekly: 'WEEK', daily: 'DAY' };

// PayPal API base URLs
const LIVE_URL = 'https://api-m.paypal.com';
const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';

// Cached access token, expiry, and resolved base URL
let cachedToken = null;
let tokenExpiresAt = 0;
let resolvedBaseUrl = null;

/**
 * Try to authenticate against a specific PayPal endpoint
 * @param {string} auth - Base64-encoded client_id:secret
 * @param {string} baseUrl - PayPal API base URL
 * @returns {Promise<object|null>} Token data or null if auth failed
 */
async function tryAuth(auth, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (e) {
    return null;
  }
}

/**
 * PayPal shared library
 * Provides API helpers, resource fetching, and unified transformations
 */
const PayPal = {
  /**
   * Initialize or return a PayPal access token
   * Tries both live and sandbox endpoints in parallel on first auth
   * @returns {Promise<string>} Access token
   */
  async init() {
    // A keyless deploy runs no live payments (#320) — before the token, and
    // before the cache below can hand one back
    assertLicensedPayments('PayPal');

    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
      return cachedToken;
    }

    const clientId = env.get('PAYPAL_CLIENT_ID');
    const clientSecret = env.get('PAYPAL_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables are required');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // First auth — try both endpoints in parallel to detect environment
    if (!resolvedBaseUrl) {
      const [liveResult, sandboxResult] = await Promise.all([
        tryAuth(auth, LIVE_URL),
        tryAuth(auth, SANDBOX_URL),
      ]);

      if (liveResult) {
        resolvedBaseUrl = LIVE_URL;
        cachedToken = liveResult.access_token;
        tokenExpiresAt = Date.now() + (liveResult.expires_in * 1000);
        return cachedToken;
      }

      if (sandboxResult) {
        resolvedBaseUrl = SANDBOX_URL;
        cachedToken = sandboxResult.access_token;
        tokenExpiresAt = Date.now() + (sandboxResult.expires_in * 1000);
        return cachedToken;
      }

      throw new Error('PayPal auth failed on both live and sandbox — check your client ID and secret');
    }

    // Subsequent auths — use the resolved endpoint
    const result = await tryAuth(auth, resolvedBaseUrl);

    if (!result) {
      throw new Error(`PayPal auth failed (${resolvedBaseUrl})`);
    }

    cachedToken = result.access_token;
    tokenExpiresAt = Date.now() + (result.expires_in * 1000);

    return cachedToken;
  },

  /**
   * Make an authenticated PayPal API request
   * @param {string} endpoint - API path (e.g., '/v1/billing/subscriptions/I-xxx')
   * @param {object} options - fetch options (method, body, etc.)
   * @returns {Promise<object>} Parsed JSON response
   */
  async request(endpoint, options = {}) {
    const token = await this.init();

    const response = await fetch(`${resolvedBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // 204 No Content
    if (response.status === 204) {
      return {};
    }

    const data = await response.json();

    if (!response.ok) {
      const msg = data.message || data.error_description || JSON.stringify(data);
      throw new Error(`PayPal API ${response.status}: ${msg}`);
    }

    return data;
  },

  /**
   * Fetch the latest resource from PayPal's API
   * PayPal's answer is the only trusted source — a lookup that fails throws the
   * classified failure ([../fetch-failure.js](../fetch-failure.js)) instead of
   * degrading to the webhook payload
   *
   * For orders: captures the payment first (moves funds), then returns the captured order
   *
   * @param {string} resourceType - 'subscription', 'order', or 'sale'
   * @param {string} resourceId - PayPal resource ID (e.g., 'I-xxx', an order ID, or a sale ID)
   * @param {object} context - Additional context (e.g., { config })
   * @returns {object} Full PayPal resource object
   */
  async fetchResource(resourceType, resourceId, context) {
    try {
      if (resourceType === 'subscription') {
        const sub = await this.request(`/v1/billing/subscriptions/${resourceId}`);

        // Fetch the plan to get product_id (subscription doesn't include it)
        if (sub.plan_id) {
          try {
            const plan = await this.request(`/v1/billing/plans/${sub.plan_id}`);
            sub._plan = plan;
          } catch (e) {
            // Plan fetch failed — continue without it
          }
        }

        return sub;
      }

      if (resourceType === 'order') {
        // Capture the order to move funds, then return the captured state
        const captured = await this.request(`/v2/checkout/orders/${resourceId}/capture`, {
          method: 'POST',
        });

        return captured;
      }

      if (resourceType === 'capture') {
        // The v2 twin of the sale branch below. A capture created by this
        // framework's own v2 Orders flow carries our custom_id directly, so
        // there is nothing to fold — one read is the whole answer
        // ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
        return await this.request(`/v2/payments/captures/${resourceId}`);
      }

      if (resourceType === 'sale') {
        // The refund of a one-time purchase names the SALE it reversed. A v1 sale
        // carries the money and the payment behind it, never our custom_id — the
        // parent payment's transaction is the only place uid/orderId/productId
        // live, so fold it onto the sale the way the subscription case folds its
        // plan ([#224](https://github.com/Omega-JS-Stack/omega/issues/224)).
        const sale = await this.request(`/v1/payments/sale/${resourceId}`);

        // v1 sometimes spells the field `custom` — normalize before deciding a
        // second read is needed, so identifiers already in hand are never dropped
        if (!sale.custom_id && sale.custom) {
          sale.custom_id = sale.custom;
        }

        if (!sale.custom_id && sale.parent_payment) {
          try {
            const payment = await this.request(`/v1/payments/payment/${sale.parent_payment}`);
            const transaction = payment.transactions?.[0];
            const custom = transaction?.custom_id || transaction?.custom || null;

            if (custom) {
              sale.custom_id = custom;
            }
          } catch (e) {
            // Parent payment fetch failed — the sale itself is still the live
            // answer, but without a folded custom_id the pipeline cannot name the
            // order this refund hits, so the miss must be visible in the logs.
            const message = `paypal fetchResource(sale/${resourceId}) could not read parent payment ${sale.parent_payment} for identifiers: ${e?.message || e}`;

            if (context?.ctx?.warn) {
              context.ctx.warn(message);
            } else {
              console.warn(`[@omega.js/backend:payment:paypal] ${message}`);
            }
          }
        }

        return sale;
      }

      throw new Error(`Unknown resource type: ${resourceType}`);
    } catch (e) {
      // An order fetch IS the capture, so its failure also means the money never moved
      throw fetchFailure(e, {
        provider: 'paypal',
        fn: 'fetchResource',
        resourceType,
        resourceId,
        consequence: resourceType === 'order'
          ? 'the order was NOT captured, so the funds have NOT moved'
          : null,
      });
    }
  },

  /**
   * Transform a raw PayPal subscription object into the unified subscription shape
   *
   * @param {object} rawSubscription - Raw PayPal subscription object (with _plan attached)
   * @param {object} options
   * @param {object} options.config - @omega.js/backend config (must contain products array)
   * @param {string} options.eventName - Name of the webhook event
   * @param {string} options.eventId - ID of the webhook event
   * @returns {object} Unified subscription object
   */
  toUnifiedSubscription(rawSubscription, options) {
    options = options || {};
    const config = options.config || {};

    const status = resolveStatus(rawSubscription);
    const cancellation = resolveCancellation(rawSubscription);
    const trial = resolveTrial(rawSubscription);
    const frequency = resolveFrequency(rawSubscription);
    const product = resolveProduct(rawSubscription, config);
    const expires = resolveExpires(rawSubscription);
    const startDate = resolveStartDate(rawSubscription);
    const price = resolvePrice(product.id, frequency, config);

    // Parse custom_id for uid and orderId
    const customData = parseCustomId(rawSubscription.custom_id);

    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    return {
      product: product,
      status: status,
      expires: expires,
      trial: trial,
      cancellation: cancellation,
      payment: {
        provider: 'paypal',
        orderId: customData.orderId || null,
        resourceId: rawSubscription.id || null,
        frequency: frequency,
        price: price,
        startDate: startDate,
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
   * Transform a raw PayPal one-time payment resource into a unified shape
   *
   * @param {object} rawResource - Raw PayPal resource (capture, order, etc.)
   * @param {object} options
   * @returns {object} Unified one-time payment object
   */
  toUnifiedOneTime(rawResource, options) {
    options = options || {};
    const config = options.config || {};

    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    // Resolve product from purchase_units custom_id (orders) or top-level custom_id (subscriptions)
    const purchaseCustomId = rawResource.purchase_units?.[0]?.custom_id;
    const customData = parseCustomId(purchaseCustomId || rawResource.custom_id);
    const productId = customData.productId;
    const product = resolveProductOneTime(productId, config);
    const price = resolvePrice(productId, 'once', config);

    return {
      product: product,
      status: rawResource.status === 'COMPLETED' ? 'completed' : rawResource.status?.toLowerCase() || 'unknown',
      payment: {
        provider: 'paypal',
        orderId: customData.orderId || null,
        resourceId: rawResource.id || null,
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
   * Resolve a PayPal plan ID from product config at runtime
   * Fetches plans for the PayPal product ID and matches by interval + amount +
   * TRIAL-cycle presence — the manager's own matching rule
   *
   * PayPal puts a trial on the PLAN, never on the subscribe call, so a product
   * with trial days carries a TWIN pair per interval: one with the TRIAL cycle
   * and one without. `trial` picks between them, which is the only way a buyer
   * who is not owed a trial gets a plan with no free cycle on it
   * ([#761](https://github.com/Omega-JS-Stack/omega/issues/761)). A trial
   * product whose skip-trial twin has not been minted yet (the manager walk has
   * not run since) throws rather than falling back to the trial twin — the fix
   * is a manage run, never a free period nobody granted.
   *
   * @param {object} product - Product from config
   * @param {string} frequency - 'monthly', 'annually', etc.
   * @param {boolean} [trial=false] - Whether this checkout is taking the trial
   * @returns {Promise<string>} PayPal plan ID
   */
  async resolvePlanId(product, frequency, trial = false) {
    if (product.archived) {
      throw new Error(`Product ${product.id} is archived`);
    }

    const paypalProductId = product.paypal?.productId;

    if (!paypalProductId) {
      throw new Error(`No PayPal product ID for ${product.id}`);
    }

    const expectedAmount = product.prices?.[frequency];

    if (!expectedAmount) {
      throw new Error(`No price configured for ${product.id}/${frequency}`);
    }

    // Fetch plans with full details (Prefer header includes billing_cycles in list response)
    // TODO: Paginate — page_size=20 only returns first page. Fine for now (each product has ~2-4 plans in 1:1 model) but will break if a product ever accumulates >20 plans.
    const response = await this.request(`/v1/billing/plans?product_id=${paypalProductId}&page_size=20&total_required=true`, {
      headers: { 'Prefer': 'return=representation' },
    });
    const plans = response.plans || [];

    // Map frequency to PayPal interval unit
    const intervalUnit = FREQUENCY_TO_INTERVAL[frequency] || 'MONTH';

    // Find matching active plan by interval + amount + trial-cycle presence
    for (const plan of plans) {
      if (plan.status !== 'ACTIVE') {
        continue;
      }

      const cycle = plan.billing_cycles?.find(c => c.tenure_type === 'REGULAR');

      if (!cycle) {
        continue;
      }

      const planInterval = cycle.frequency?.interval_unit;
      const planAmount = parseFloat(cycle.pricing_scheme?.fixed_price?.value || '0');
      const planHasTrial = !!plan.billing_cycles?.find(c => c.tenure_type === 'TRIAL');

      if (planInterval === intervalUnit && planAmount === expectedAmount && planHasTrial === !!trial) {
        return plan.id;
      }
    }

    throw new Error(`No active PayPal plan for ${product.id}/${frequency} at $${expectedAmount} ${trial ? 'with' : 'without'} a trial cycle (product: ${paypalProductId}) — run the manager payment walk to mint it`);
  },

  /**
   * Extract the resource a PayPal webhook envelope carries
   * Identifiers only — the payload never drives state ([../fetch-failure.js](../fetch-failure.js))
   *
   * @param {object} raw - Raw PayPal webhook payload
   * @returns {object|null}
   */
  extractResource(raw) {
    return raw?.resource || null;
  },

  /**
   * Extract the internal orderId from a PayPal resource
   * Stripe stores orderId in resource.metadata.orderId, but PayPal stores it in custom_id
   *
   * @param {object} resource - Raw PayPal resource (subscription or order)
   * @returns {string|null}
   */
  getOrderId(resource) {
    const purchaseCustomId = resource.purchase_units?.[0]?.custom_id;
    const customData = parseCustomId(purchaseCustomId || resource.custom_id);
    return customData.orderId || null;
  },

  /**
   * Extract the UID from a PayPal resource's custom_id
   * Used to resolve UID after fetchResource() for events like PAYMENT.SALE
   * where the initial webhook payload doesn't carry custom_id
   *
   * @param {object} resource - Raw PayPal resource (subscription or order)
   * @returns {string|null}
   */
  getUid(resource) {
    const purchaseCustomId = resource.purchase_units?.[0]?.custom_id;
    const customData = parseCustomId(purchaseCustomId || resource.custom_id);
    return customData?.uid || null;
  },

  /**
   * What a PayPal refund actually moved, read back from PayPal's own refund record
   *
   * The resource already in hand is no use here: it is the sale or the capture the
   * refund reversed — the ORIGINAL payment, whose amount is the purchase price and
   * not the refund's, which is simply wrong for a partial refund. And the amounts
   * used to come from the webhook envelope, so a payload naming an inflated total
   * wrote that number onto the order and into the customer's refund email
   * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
   *
   * So the refund is fetched by its OWN id — the one the parser keeps beside the
   * resourceId it reassigned to the sale/capture — and only the id comes from the
   * event, the same trust level as the resourceId every lookup here starts from.
   * v2 capture refunds read at `/v2/payments/refunds/{id}`; v1 sale refunds (both
   * the one-time and the subscription path) at `/v1/payments/refund/{id}`.
   *
   * The record that answers has to point BACK at the sale or capture the event
   * named, or it is another order's refund and the event is refused
   * ([../refund-linkage.js](../refund-linkage.js)).
   *
   * @param {object} resource - The resource the refund reversed, as PayPal answered for it (the record it must link back to)
   * @param {object} [options] - { refundId, eventType, resourceType, raw, ctx }
   * @returns {Promise<{ amount: string|null, currency: string, reason: string|null }>}
   */
  async getRefundDetails(resource, options = {}) {
    // A doc stored before the parser threaded the id still names the refund in the
    // envelope it carries — an identifier, read the same way resourceId is
    const refundId = options.refundId || options.raw?.resource?.id || null;

    if (!refundId) {
      const message = `paypal getRefundDetails(): ${options.eventType || 'refund event'} names no refund id, so PayPal cannot be asked what came back — the refund is recorded with no amount rather than with the payload's`;

      if (options.ctx?.warn) {
        options.ctx.warn(message);
      } else {
        console.warn(`[@omega.js/backend:payment:paypal] ${message}`);
      }

      return { amount: null, currency: 'USD', reason: null };
    }

    const endpoint = options.eventType === 'PAYMENT.CAPTURE.REFUNDED'
      ? `/v2/payments/refunds/${refundId}`
      : `/v1/payments/refund/${refundId}`;

    let refund;

    try {
      refund = await this.request(endpoint);
    } catch (e) {
      throw fetchFailure(e, { provider: 'paypal', fn: 'getRefundDetails', resourceType: 'refund', resourceId: refundId });
    }

    // The refund is a SECOND record, keyed by an id the payload chose: without a
    // link back to the sale or capture this event is about, an unrelated refund
    // from the same account would have booked its amount onto this order
    // ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)). PayPal writes
    // that link both ways round — a v1 refund names its `sale_id`, a v2 refund
    // links `up` to its capture. A refund of a SUBSCRIPTION's sale names the sale,
    // never the billing agreement the event resolved to, so there is nothing to
    // compare and the linkage helper says so out loud.
    assertRefundLinkage({
      provider: 'paypal',
      refundType: 'refund',
      refundId: refundId,
      resourceType: options.resourceType || 'resource',
      resourceId: resource?.id || null,
      expected: resource?.id || null,
      ctx: options.ctx,
      ...refundLink(refund, options.resourceType),
    });

    return {
      // v1 spells the amount `total`/`currency`, v2 spells it
      // `value`/`currency_code` — a v2 capture refund read only the v1
      // spelling and landed a null amount on the order record and the
      // customer's refund email
      // ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
      amount: refund?.amount?.total || refund?.amount?.value || refund?.total_refunded_amount?.value || null,
      currency: refund?.amount?.currency || refund?.amount?.currency_code || 'USD',
      reason: refund?.reason_code || null,
    };
  },

  /**
   * Build the custom_id string for PayPal subscriptions and orders
   * Format: uid:{uid},orderId:{orderId} or uid:{uid},orderId:{orderId},productId:{productId}
   *
   * @param {string} uid - User's Firebase UID
   * @param {string} orderId - Our internal order ID
   * @param {string} [productId] - Product ID (used for one-time payments)
   * @returns {string}
   */
  buildCustomId(uid, orderId, productId) {
    let customId = `uid:${uid},orderId:${orderId}`;

    if (productId) {
      customId += `,productId:${productId}`;
    }

    return customId;
  },
};

/**
 * The back-pointer a PayPal refund record carries to the payment it reversed
 *
 * A v1 refund names its `sale_id`; a v2 refund links `up` to its capture. The
 * refund of a SUBSCRIPTION's sale names the sale, never the billing agreement the
 * event resolved to, so that path has nothing to compare and says so
 * ([refund-linkage.js](../refund-linkage.js)).
 *
 * @param {object} refund - The fetched refund record
 * @param {string} resourceType - The event's resource type ('sale' | 'capture')
 * @returns {{ field: string|null, found: string|null }}
 */
function refundLink(refund, resourceType) {
  if (resourceType === 'sale') {
    return { field: 'sale_id', found: refund?.sale_id || null };
  }

  if (resourceType === 'capture') {
    return { field: 'links[rel=up]', found: parseUpLinkId(refund?.links) };
  }

  return { field: null, found: null };
}

/**
 * The id a v2 record points `up` at, read off its HATEOAS links
 *
 * PayPal names a v2 refund's parent capture with a link whose `rel` is `up`, and
 * the id is that URL's last segment — the only back-pointer a v2 refund carries
 * ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)).
 *
 * @param {Array|undefined} links - The record's HATEOAS links
 * @returns {string|null}
 */
function parseUpLinkId(links) {
  const up = (links || []).find((link) => link?.rel === 'up');

  if (!up?.href) {
    return null;
  }

  return up.href.split('/').filter(Boolean).pop() || null;
}

/**
 * Parse the custom_id string from a PayPal subscription
 * Format: uid:{uid},orderId:{orderId}
 *
 * @param {string} customId - The custom_id string
 * @returns {{ uid: string|null, orderId: string|null, productId: string|null }}
 */
function parseCustomId(customId) {
  if (!customId) {
    return { uid: null, orderId: null, productId: null };
  }

  const result = { uid: null, orderId: null, productId: null };

  for (const part of customId.split(',')) {
    const [key, ...valueParts] = part.split(':');
    const value = valueParts.join(':'); // Handle values that contain colons

    if (key === 'uid') {
      result.uid = value || null;
    } else if (key === 'orderId') {
      result.orderId = value || null;
    } else if (key === 'productId') {
      result.productId = value || null;
    }
  }

  return result;
}

/**
 * Is this subscription still INSIDE its free trial?
 *
 * The trial WINDOW is the answer, not the payment record: conversion happens at
 * the trial's end, so a subscription whose trial end is still ahead of it cannot
 * have converted, whatever money has changed hands. A plan carrying a setup fee
 * charges one on day zero, and reading that fee as a paid billing period is what
 * made a cancelled trial look like a paid term with time left on it
 * ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)).
 *
 * A trial with no computable end (no `start_time`) reads FALSE — this decides
 * whether access is revoked, and missing data must never be the thing that
 * revokes it.
 *
 * @param {object} raw - Raw PayPal subscription (with _plan attached)
 * @returns {boolean}
 */
function isInTrial(raw) {
  const trial = resolveTrial(raw);

  return !!(trial.claimed && trial.expires.timestampUNIX > Math.floor(Date.now() / 1000));
}

/**
 * Calculate when the current billing period ends based on last payment + interval
 * Used for cancelled subs to determine remaining access time
 *
 * @param {object} raw - Raw PayPal subscription (with _plan attached)
 * @returns {Date|null} Period end date, or null if cannot be calculated
 */
function calculatePeriodEnd(raw) {
  // A TRIAL has no paid period to serve out, so cancelling one ends access NOW
  // (Ian's ruling, 2026-08-15 — we do not keep serving a trial we know will not
  // convert). This is the ONE place the three cancelled-subscription readers
  // below share, so status, cancellation and expiry can never disagree about it.
  if (isInTrial(raw)) {
    return null;
  }

  const lastPayment = raw.billing_info?.last_payment?.time;

  if (!lastPayment) {
    return null;
  }

  const plan = raw._plan;
  const regularCycle = plan?.billing_cycles?.find(c => c.tenure_type === 'REGULAR');

  if (!regularCycle) {
    return null;
  }

  const unit = regularCycle.frequency.interval_unit;
  const count = regularCycle.frequency.interval_count || 1;
  const lastDate = new Date(lastPayment);

  if (unit === 'YEAR') {
    lastDate.setFullYear(lastDate.getFullYear() + count);
  } else if (unit === 'MONTH') {
    lastDate.setMonth(lastDate.getMonth() + count);
  } else if (unit === 'WEEK') {
    lastDate.setDate(lastDate.getDate() + (count * 7));
  } else if (unit === 'DAY') {
    lastDate.setDate(lastDate.getDate() + count);
  }

  return lastDate;
}

/**
 * Map PayPal subscription status to unified status
 *
 * | PayPal Status    | Unified Status |
 * |------------------|----------------|
 * | ACTIVE           | active         |
 * | SUSPENDED        | suspended      |
 * | CANCELLED (period remaining) | active (with cancellation.pending) |
 * | CANCELLED (period ended)     | cancelled      |
 * | EXPIRED          | cancelled      |
 * | APPROVAL_PENDING | cancelled      |
 * | APPROVED         | active         |
 */
function resolveStatus(raw) {
  const status = raw.status;

  if (status === 'ACTIVE' || status === 'APPROVED') {
    return 'active';
  }

  if (status === 'SUSPENDED') {
    return 'suspended';
  }

  // CANCELLED — check if user still has paid time remaining
  if (status === 'CANCELLED') {
    const periodEnd = calculatePeriodEnd(raw);

    if (periodEnd && periodEnd > new Date()) {
      // User still has access until period end — treat as active with pending cancellation
      return 'active';
    }

    return 'cancelled';
  }

  // EXPIRED, APPROVAL_PENDING, or anything else
  return 'cancelled';
}

/**
 * Resolve cancellation state from PayPal subscription
 *
 * PayPal has no cancel_at_period_end like Stripe. When cancelled:
 * - If billing period hasn't ended: pending=true, date=period end (user keeps access)
 * - If billing period has ended: pending=false, date=cancellation time (fully cancelled)
 */
function resolveCancellation(raw) {
  if (raw.status === 'CANCELLED') {
    const periodEnd = calculatePeriodEnd(raw);

    // Period still active — pending cancellation (user keeps access until period end)
    if (periodEnd && periodEnd > new Date()) {
      const periodEndStr = powertools.timestamp(periodEnd, { output: 'string' });

      return {
        pending: true,
        date: {
          timestamp: periodEndStr,
          timestampUNIX: powertools.timestamp(periodEndStr, { output: 'unix' }),
        },
      };
    }

    // Period has ended — fully cancelled
    const cancelDate = raw.status_update_time
      ? powertools.timestamp(new Date(raw.status_update_time), { output: 'string' })
      : EPOCH_ZERO;

    return {
      pending: false,
      date: {
        timestamp: cancelDate,
        timestampUNIX: cancelDate !== EPOCH_ZERO
          ? powertools.timestamp(cancelDate, { output: 'unix' })
          : EPOCH_ZERO_UNIX,
      },
    };
  }

  return {
    pending: false,
    date: {
      timestamp: EPOCH_ZERO,
      timestampUNIX: EPOCH_ZERO_UNIX,
    },
  };
}

/**
 * Resolve trial state from PayPal subscription
 * PayPal trials are represented as billing_cycles with tenure_type === 'TRIAL'
 */
function resolveTrial(raw) {
  // Check if the plan has a trial cycle
  const plan = raw._plan || {};
  const trialCycle = plan.billing_cycles?.find(c => c.tenure_type === 'TRIAL');

  if (!trialCycle) {
    return {
      claimed: false,
      expires: { timestamp: EPOCH_ZERO, timestampUNIX: EPOCH_ZERO_UNIX },
    };
  }

  // PayPal doesn't expose exact trial start/end dates on the subscription
  // We can calculate from start_time + trial duration
  const startTime = raw.start_time ? new Date(raw.start_time) : null;

  if (!startTime) {
    return {
      claimed: true,
      expires: { timestamp: EPOCH_ZERO, timestampUNIX: EPOCH_ZERO_UNIX },
    };
  }

  // Calculate trial end based on trial cycle frequency
  const trialFreq = trialCycle.frequency;
  const trialCount = trialCycle.total_cycles || 1;
  const trialEnd = new Date(startTime);

  if (trialFreq?.interval_unit === 'DAY') {
    trialEnd.setDate(trialEnd.getDate() + (trialFreq.interval_count || 1) * trialCount);
  } else if (trialFreq?.interval_unit === 'MONTH') {
    trialEnd.setMonth(trialEnd.getMonth() + (trialFreq.interval_count || 1) * trialCount);
  }

  const trialEndStr = powertools.timestamp(trialEnd, { output: 'string' });

  return {
    claimed: true,
    expires: {
      timestamp: trialEndStr,
      timestampUNIX: powertools.timestamp(trialEndStr, { output: 'unix' }),
    },
  };
}

/**
 * Resolve billing frequency from PayPal subscription
 */
function resolveFrequency(raw) {
  // Try _plan first (fetched separately)
  const plan = raw._plan || {};
  const regularCycle = plan.billing_cycles?.find(c => c.tenure_type === 'REGULAR');

  if (regularCycle?.frequency?.interval_unit) {
    return INTERVAL_TO_FREQUENCY[regularCycle.frequency.interval_unit] || null;
  }

  // Fallback: try inline plan info from ?fields=plan
  const inlinePlan = raw.plan;
  if (inlinePlan?.billing_cycles) {
    const cycle = inlinePlan.billing_cycles.find(c => c.tenure_type === 'REGULAR');
    if (cycle?.frequency?.interval_unit) {
      return INTERVAL_TO_FREQUENCY[cycle.frequency.interval_unit] || null;
    }
  }

  return null;
}

/**
 * Resolve product by matching the PayPal product ID against config products
 * Uses: sub._plan.product_id → match config product.paypal.productId
 * Also checks paypal.legacyProductIds[] for migrated products
 */
function resolveProduct(raw, config) {
  // Get PayPal product ID from the plan (attached during fetchResource)
  const paypalProductId = raw._plan?.product_id || null;

  if (!paypalProductId || !config.payment?.products) {
    return { id: 'basic', name: 'Basic' };
  }

  for (const product of config.payment.products) {
    // Check current product ID
    if (product.paypal?.productId === paypalProductId) {
      return { id: product.id, name: product.name || product.id };
    }

    // Check legacy product IDs (for migrated products)
    if (product.paypal?.legacyProductIds?.includes(paypalProductId)) {
      return { id: product.id, name: product.name || product.id };
    }
  }

  return { id: 'basic', name: 'Basic' };
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
 * Resolve subscription expiration from PayPal data
 *
 * For cancelled subs with remaining time, uses calculated period end.
 * For active subs, uses next_billing_time.
 */
function resolveExpires(raw) {
  // Cancelled subs with remaining time — use calculated period end
  if (raw.status === 'CANCELLED') {
    const periodEnd = calculatePeriodEnd(raw);

    if (periodEnd && periodEnd > new Date()) {
      const expiresStr = powertools.timestamp(periodEnd, { output: 'string' });

      return {
        timestamp: expiresStr,
        timestampUNIX: powertools.timestamp(expiresStr, { output: 'unix' }),
      };
    }
  }

  // Active subs: PayPal's billing_info.next_billing_time is the closest to "period end"
  const nextBilling = raw.billing_info?.next_billing_time;

  if (!nextBilling) {
    return {
      timestamp: EPOCH_ZERO,
      timestampUNIX: EPOCH_ZERO_UNIX,
    };
  }

  const expiresDate = powertools.timestamp(new Date(nextBilling), { output: 'string' });

  return {
    timestamp: expiresDate,
    timestampUNIX: powertools.timestamp(expiresDate, { output: 'unix' }),
  };
}

/**
 * Resolve subscription start date from PayPal data
 */
function resolveStartDate(raw) {
  const startTime = raw.start_time || raw.create_time;

  if (!startTime) {
    return {
      timestamp: EPOCH_ZERO,
      timestampUNIX: EPOCH_ZERO_UNIX,
    };
  }

  const startDate = powertools.timestamp(new Date(startTime), { output: 'string' });

  return {
    timestamp: startDate,
    timestampUNIX: powertools.timestamp(startDate, { output: 'unix' }),
  };
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

module.exports = PayPal;
