const powertools = require('node-powertools');
const fetchFailure = require('../fetch-failure.js');
const assertRefundLinkage = require('../refund-linkage.js');
const env = require('../../env.js');

// Lazy singleton Stripe SDK instance
let stripeInstance = null;

// Epoch zero timestamps (used as default/empty dates)
const EPOCH_ZERO = powertools.timestamp(new Date(0), { output: 'string' });
const EPOCH_ZERO_UNIX = powertools.timestamp(EPOCH_ZERO, { output: 'unix' });

// Stripe interval → unified frequency map
const INTERVAL_TO_FREQUENCY = { year: 'annually', month: 'monthly', week: 'weekly', day: 'daily' };
const FREQUENCY_TO_INTERVAL = { annually: 'year', monthly: 'month', weekly: 'week', daily: 'day' };

/**
 * Stripe shared library
 * Provides SDK initialization, resource fetching, and unified transformations
 */
const Stripe = {
  /**
   * Initialize or return the Stripe SDK instance
   * @param {string} secretKey - Stripe secret key
   * @returns {object} Stripe SDK instance
   */
  init() {
    if (!stripeInstance) {
      const secretKey = env.get('STRIPE_SECRET_KEY');

      if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY environment variable is required');
      }

      stripeInstance = new (require('stripe'))(secretKey);
    }

    return stripeInstance;
  },

  /**
   * Fetch the latest resource from Stripe's API
   * Stripe's answer is the only trusted source — a lookup that fails throws the
   * classified failure ([../fetch-failure.js](../fetch-failure.js)) instead of
   * degrading to the webhook payload
   *
   * @param {string} resourceType - 'subscription' | 'invoice' | 'session' | 'charge'
   * @param {string} resourceId - Stripe resource ID
   * @param {object} context - Additional context (e.g., { admin })
   * @returns {object} Full Stripe resource object
   */
  async fetchResource(resourceType, resourceId, context) {
    const stripe = this.init();

    try {
      if (resourceType === 'subscription') {
        return await stripe.subscriptions.retrieve(resourceId);
      }

      if (resourceType === 'invoice') {
        return await stripe.invoices.retrieve(resourceId);
      }

      if (resourceType === 'session') {
        return await stripe.checkout.sessions.retrieve(resourceId);
      }

      if (resourceType === 'charge') {
        // The refund of a one-time purchase carries the charge and nothing else.
        // A charge inherits its metadata from the PaymentIntent that created it,
        // so expand the intent: when the charge itself carries none, the intent
        // is the only place uid/orderId/productId live
        // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
        const charge = await stripe.charges.retrieve(resourceId, { expand: ['payment_intent'] });
        const intentMetadata = charge.payment_intent?.metadata;

        if (intentMetadata) {
          return { ...charge, metadata: { ...intentMetadata, ...charge.metadata } };
        }

        return charge;
      }

      throw new Error(`Unknown resource type: ${resourceType}`);
    } catch (e) {
      throw fetchFailure(e, { provider: 'stripe', resourceType, resourceId });
    }
  },

  /**
   * Extract the resource a Stripe webhook envelope carries
   * Identifiers only — the payload never drives state ([../fetch-failure.js](../fetch-failure.js))
   *
   * @param {object} raw - Raw Stripe webhook payload
   * @returns {object|null}
   */
  extractResource(raw) {
    return raw?.data?.object || null;
  },

  /**
   * Extract the internal orderId from a Stripe resource
   *
   * @param {object} resource - Raw Stripe resource (subscription, session, invoice)
   * @returns {string|null}
   */
  getOrderId(resource) {
    return resource.metadata?.orderId || null;
  },

  /**
   * Extract the UID from a Stripe resource's metadata
   * Used to resolve UID after fetchResource() for parity with PayPal
   *
   * @param {object} resource - Raw Stripe resource (subscription, session, invoice)
   * @returns {string|null}
   */
  getUid(resource) {
    return resource.metadata?.uid || null;
  },

  /**
   * What a Stripe refund actually moved, from Stripe's own record of the charge
   * Returns a unified shape so transition handlers stay provider-agnostic
   *
   * The amounts used to be read off the webhook envelope, so a payload naming an
   * inflated `amount_refunded` wrote that number onto the order and into the
   * customer's refund email ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
   * They come from the charge Stripe answered for now: the one-time refund path
   * already fetched it (`resourceType: 'charge'`), and the subscription path — whose
   * fetched resource is the SUBSCRIPTION the refunded charge belongs to — reads it
   * back by the charge id the payload names. An id is an identifier, the same trust
   * level as the resourceId the event is looked up by; the numbers are Stripe's.
   *
   * Two things guard that second lookup: an envelope that names no charge at all
   * fails PERMANENTLY before the call rather than deferring a malformed shape to
   * the retry ladder ([#536](https://github.com/Omega-JS-Stack/omega/issues/536)),
   * and the charge it does answer with has to link back to the subscription the
   * event is about ([../refund-linkage.js](../refund-linkage.js)).
   *
   * @param {object} resource - The resource already fetched from Stripe (the record the charge must link back to)
   * @param {object} [options] - { raw, eventType, ctx } — the envelope, for the charge id only
   * @returns {Promise<{ amount: string|null, currency: string, reason: string|null }>}
   */
  async getRefundDetails(resource, options = {}) {
    // The charge the one-time path already fetched IS the answer, and it was
    // fetched by the event's own resourceId — self-consistent, nothing to link
    if (resource?.object === 'charge') {
      return this.toRefundDetails(resource);
    }

    const chargeId = options.raw?.data?.object?.id || null;

    // A refund envelope that names no charge cannot be looked up, and handing
    // `undefined` to the SDK threw something that is not a 404 — so the #506 seam
    // read a malformed envelope as UNREACHABLE and deferred it to the retry
    // ladder, ten minutes at a time, until the dead-letter ceiling. Nothing about
    // a shape like this gets better on the sixth attempt
    // ([#536](https://github.com/Omega-JS-Stack/omega/issues/536)).
    if (!chargeId) {
      const failure = new Error(`stripe getRefundDetails(): ${options.eventType || 'refund event'} carries no charge id at data.object.id, so Stripe cannot be asked what came back — the envelope arrived as ${describeEnvelope(options.raw)}`);

      failure.permanent = true;

      throw failure;
    }

    const charge = await this.fetchResource('charge', chargeId, options);

    // The charge is a SECOND record, keyed by an id the payload chose: without a
    // link back to the subscription this event is about, an unrelated charge from
    // the same account would have booked its refund onto this order
    // ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)). Stripe writes
    // that link twice — the subscription the charge was made for, and the uid it
    // was made under — and either one settles it.
    const link = charge?.subscription
      ? { field: 'subscription', found: charge.subscription, expected: resource?.id || null }
      : { field: 'metadata.uid', found: this.getUid(charge || {}), expected: this.getUid(resource || {}) };

    assertRefundLinkage({
      provider: 'stripe',
      refundType: 'charge',
      refundId: chargeId,
      resourceType: resource?.object || 'resource',
      resourceId: resource?.id || null,
      ctx: options.ctx,
      ...link,
    });

    return this.toRefundDetails(charge);
  },

  /**
   * Read the refund off a charge Stripe answered with
   *
   * The transform half of getRefundDetails(), split out because the test provider
   * is its own API: it holds the charge already and must never reach for Stripe's.
   *
   * @param {object} charge - A Stripe charge object
   * @returns {{ amount: string|null, currency: string, reason: string|null }}
   */
  toRefundDetails(charge) {
    const amountCents = charge?.amount_refunded;
    const latestRefund = charge?.refunds?.data?.[0];

    return {
      amount: amountCents ? (amountCents / 100).toFixed(2) : null,
      currency: charge?.currency?.toUpperCase() || 'USD',
      reason: latestRefund?.reason || null,
    };
  },

  /**
   * Transform a raw Stripe subscription object into the unified subscription shape
   * This produces the exact same object stored in users/{uid}.subscription
   *
   * @param {object} rawSubscription - Raw Stripe subscription object
   * @param {object} options
   * @param {object} options.config - @omega.js/backend config (must contain products array)
   * @param {string} options.eventName - Name of the webhook event (e.g., 'customer.subscription.updated')
   * @param {string} options.eventId - ID of the webhook event (e.g., 'evt_xxx')
   * @returns {object} Unified subscription object
   */
  toUnifiedSubscription(rawSubscription, options) {
    options = options || {};
    const config = options.config || {};

    // Resolve status
    const status = resolveStatus(rawSubscription);

    // Resolve cancellation
    const cancellation = resolveCancellation(rawSubscription);

    // Resolve trial
    const trial = resolveTrial(rawSubscription);

    // Resolve frequency
    const frequency = resolveFrequency(rawSubscription);

    // Resolve product from price
    const product = resolveProduct(rawSubscription, config);

    // Resolve expiration
    const expires = resolveExpires(rawSubscription);

    // Resolve start date
    const startDate = resolveStartDate(rawSubscription);

    // Resolve price from config
    const price = resolvePrice(product.id, frequency, config);

    // Build the unified subscription object
    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    return {
      product: product,
      status: status,
      expires: expires,
      trial: trial,
      cancellation: cancellation,
      payment: {
        provider: 'stripe',
        orderId: rawSubscription.metadata?.orderId || null,
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
   * Find an existing Stripe customer by uid metadata, or create one
   *
   * @param {string} uid - User's UID
   * @param {string|null} email - User's email (used when creating a new customer)
   * @param {object} ctx - Assistant instance for logging
   * @returns {object} Stripe customer object
   */
  async resolveCustomer(uid, email, ctx) {
    const stripe = this.init();

    // Search for existing customer with this uid
    const search = await stripe.customers.search({
      query: `metadata['uid']:'${uid}'`,
      limit: 1,
    });

    if (search.data.length > 0) {
      const existing = search.data[0];
      ctx.log(`Found existing Stripe customer: ${existing.id}`);
      return existing;
    }

    // Create new customer
    // Use an idempotency key scoped to the uid so concurrent creates (e.g. user
    // double-clicks checkout) return the same customer instead of duplicates.
    // Stripe caches the response under this key for 24 hours.
    const params = {
      metadata: { uid },
    };

    if (email) {
      params.email = email;
    }

    const customer = await stripe.customers.create(params, {
      idempotencyKey: `backend-customer-create-${uid}`,
    });
    ctx.log(`Created new Stripe customer: ${customer.id}`);
    return customer;
  },

  /**
   * Resolve the Stripe price ID by fetching active prices from the Stripe product
   * and matching by interval + amount.
   *
   * @param {object} product - Product object from config (must have .prices and .stripe.productId)
   * @param {string} productType - 'subscription' or 'one-time'
   * @param {string} frequency - 'monthly', 'annually', etc. (subscriptions) — ignored for one-time
   * @returns {Promise<string>} Stripe price ID
   * @throws {Error} If product is archived, missing Stripe product ID, or no matching price found
   */
  async resolvePriceId(product, productType, frequency) {
    if (product.archived) {
      throw new Error(`Product ${product.id} is archived`);
    }

    const stripeProductId = product.stripe?.productId;

    if (!stripeProductId) {
      throw new Error(`No Stripe product ID for ${product.id}`);
    }

    const key = productType === 'subscription' ? frequency : 'once';
    const expectedAmount = product.prices?.[key];

    if (!expectedAmount) {
      throw new Error(`No price configured for ${product.id}/${key}`);
    }

    const amountCents = Math.round(expectedAmount * 100);

    // Fetch active prices from Stripe for this product
    const stripe = this.init();

    const prices = [];
    for await (const price of stripe.prices.list({ product: stripeProductId, active: true, limit: 100 })) {
      prices.push(price);
    }

    // Match by interval + amount
    if (productType === 'subscription') {
      const interval = FREQUENCY_TO_INTERVAL[frequency] || 'month';
      const match = prices.find(p =>
        p.recurring?.interval === interval
        && p.unit_amount === amountCents
      );

      if (!match) {
        throw new Error(`No active Stripe price for ${product.id}/${frequency} at $${expectedAmount} (product: ${stripeProductId})`);
      }

      return match.id;
    }

    // One-time: match by amount, no recurring
    const match = prices.find(p => !p.recurring && p.unit_amount === amountCents);

    if (!match) {
      throw new Error(`No active Stripe price for ${product.id}/once at $${expectedAmount} (product: ${stripeProductId})`);
    }

    return match.id;
  },

  /**
   * Resolve or create a Stripe coupon for a discount
   * Uses a deterministic ID so the same discount always maps to the same coupon
   *
   * Stripe coupons come in two shapes and a discount is one or the other:
   * `percent_off`, or `amount_off` in the currency's MINOR unit (cents) with a
   * `currency` beside it — Stripe rejects an amount coupon without one. The two
   * shapes carry different ids so a code can never collide with the other form,
   * and the `_ONCE` ids are byte-identical to what they have always been, so
   * coupons already live in a brand's account keep resolving instead of
   * duplicating under a new id
   * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
   *
   * TWO callers now: the checkout's discount codes and the cancel flow's save
   * offer ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)), which is
   * also the only reason `duration` is read off the discount rather than fixed —
   * an offer a brand configured as `forever` is a permanent price cut and gets
   * its own coupon, never the one-cycle one.
   *
   * Verified against the params the SDK is asked to create, not against Stripe:
   * live-provider verification is a Stage 3 item, the same trust level as the
   * rest of this library ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
   *
   * @param {object} discount - A discount-codes validate() result (or the save offer as one)
   * @param {object} ctx - Assistant instance for logging + the brand's currency
   * @returns {Promise<string>} The Stripe coupon id
   */
  async resolveCoupon(discount, ctx) {
    const stripe = this.init();

    const isAmount = discount.amount > 0;
    const duration = discount.duration || 'once';
    const currency = ctx.Manager?.config?.payment?.currency || 'USD';
    const scope = duration.toUpperCase();
    const appliesTo = duration === 'once' ? 'first payment' : 'every payment';
    const couponId = isAmount
      ? `BEM_${discount.code}_${discount.amount}AMTOFF_${scope}`
      : `BEM_${discount.code}_${discount.percent}OFF_${scope}`;

    try {
      // Check if coupon already exists
      await stripe.coupons.retrieve(couponId);
      ctx.log(`Stripe coupon exists: ${couponId}`);
      return couponId;
    } catch (e) {
      if (e.code !== 'resource_missing') {
        throw e;
      }
    }

    // Create the coupon
    // Idempotency key uses the deterministic couponId so concurrent requests for
    // the same discount don't race each other into a duplicate-create error.
    // Stripe returns the cached response for 24 hours.
    await stripe.coupons.create({
      id: couponId,
      duration: duration,
      ...(isAmount
        ? {
          amount_off: Math.round(discount.amount * 100),
          currency: currency.toLowerCase(),
          name: `${discount.code} (${discount.amount.toFixed(2)} ${currency.toUpperCase()} off ${appliesTo})`,
        }
        : {
          percent_off: discount.percent,
          name: `${discount.code} (${discount.percent}% off ${appliesTo})`,
        }),
    }, {
      idempotencyKey: `backend-coupon-${couponId}`,
    });

    ctx.log(`Stripe coupon created: ${couponId}`);
    return couponId;
  },

  /**
   * Transform a raw Stripe one-time payment resource into a unified shape
   * Mirrors subscription structure: { product, status, payment: { ... } }
   *
   * @param {object} rawResource - Raw Stripe resource (session, invoice, etc.)
   * @param {object} options
   * @returns {object} Unified one-time payment object
   */
  toUnifiedOneTime(rawResource, options) {
    options = options || {};
    const config = options.config || {};

    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    // Resolve product + price from config
    const productId = rawResource.metadata?.productId;
    const product = resolveProductOneTime(productId, config);
    const price = resolvePrice(productId, 'once', config);

    return {
      product: product,
      status: rawResource.status === 'complete' ? 'completed' : rawResource.status || 'unknown',
      payment: {
        provider: 'stripe',
        orderId: rawResource.metadata?.orderId || null,
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
};

/**
 * Say what a webhook envelope actually looked like
 *
 * A malformed envelope is a programmer/parser error, and the only thing that makes
 * one debuggable is knowing what arrived instead of what was expected: the event
 * type, and the keys the object it carried DID have
 * ([#536](https://github.com/Omega-JS-Stack/omega/issues/536)).
 *
 * @param {object|null} raw - The raw Stripe webhook payload
 * @returns {string}
 */
function describeEnvelope(raw) {
  const object = raw?.data?.object;

  if (!object || typeof object !== 'object') {
    return `type=${raw?.type || 'unknown'}, data.object=${object === undefined ? 'absent' : JSON.stringify(object)}`;
  }

  return `type=${raw?.type || 'unknown'}, data.object.object=${object.object || 'unnamed'}, data.object keys=[${Object.keys(object).join(', ')}]`;
}

/**
 * Map Stripe subscription status to unified status
 *
 * | Stripe Status        | Unified Status |
 * |----------------------|----------------|
 * | active               | active         |
 * | trialing             | active         |
 * | past_due             | suspended      |
 * | unpaid               | suspended      |
 * | canceled             | cancelled      |
 * | incomplete           | cancelled      |
 * | incomplete_expired   | cancelled      |
 */
function resolveStatus(raw) {
  const stripeStatus = raw.status;

  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    return 'active';
  }

  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
    return 'suspended';
  }

  // canceled, incomplete, incomplete_expired, or anything else
  return 'cancelled';
}

/**
 * Resolve cancellation state from Stripe subscription
 * Handles cancel_at_period_end for pending cancellations
 */
function resolveCancellation(raw) {
  // Pending cancellation: active but set to cancel at period end
  if (raw.cancel_at_period_end) {
    const periodEnd = raw.current_period_end || raw.items?.data?.[0]?.current_period_end || 0;
    const cancelAt = raw.cancel_at
      ? powertools.timestamp(new Date(raw.cancel_at * 1000), { output: 'string' })
      : powertools.timestamp(new Date(periodEnd * 1000), { output: 'string' });

    return {
      pending: true,
      date: {
        timestamp: cancelAt,
        timestampUNIX: powertools.timestamp(cancelAt, { output: 'unix' }),
      },
    };
  }

  // Already cancelled
  if (raw.canceled_at) {
    const cancelledDate = powertools.timestamp(new Date(raw.canceled_at * 1000), { output: 'string' });

    return {
      pending: false,
      date: {
        timestamp: cancelledDate,
        timestampUNIX: powertools.timestamp(cancelledDate, { output: 'unix' }),
      },
    };
  }

  // No cancellation
  return {
    pending: false,
    date: {
      timestamp: EPOCH_ZERO,
      timestampUNIX: EPOCH_ZERO_UNIX,
    },
  };
}

/**
 * Resolve trial state from Stripe subscription
 */
function resolveTrial(raw) {
  const trialStart = raw.trial_start ? raw.trial_start * 1000 : 0;
  const trialEnd = raw.trial_end ? raw.trial_end * 1000 : 0;
  const activated = !!(trialStart && trialEnd);

  // Build trial expiration
  let trialExpires = { timestamp: EPOCH_ZERO, timestampUNIX: EPOCH_ZERO_UNIX };
  if (trialEnd) {
    const trialEndDate = powertools.timestamp(new Date(trialEnd), { output: 'string' });
    trialExpires = {
      timestamp: trialEndDate,
      timestampUNIX: powertools.timestamp(trialEndDate, { output: 'unix' }),
    };
  }

  return {
    claimed: activated,
    expires: trialExpires,
  };
}

/**
 * Resolve billing frequency from Stripe subscription
 */
function resolveFrequency(raw) {
  // Stripe stores interval on the plan/price object
  const interval = raw.plan?.interval
    || raw.items?.data?.[0]?.price?.recurring?.interval
    || null;

  return INTERVAL_TO_FREQUENCY[interval] || null;
}

/**
 * Resolve product by matching the Stripe product ID against config products
 * Returns { id, name } — falls back to basic if no match is found
 */
function resolveProduct(raw, config) {
  // Get the Stripe product ID from the subscription
  const stripeProductId = raw.items?.data?.[0]?.price?.product
    || raw.plan?.product
    || null;

  if (!stripeProductId || !config.payment?.products) {
    return { id: 'basic', name: 'Basic' };
  }

  // Test-mode sentinel: the test provider synthesizes "_test_<id>" when no real
  // Stripe product is configured. Map it back to the matching @omega.js/backend product so the
  // pipeline can be exercised end-to-end without real Stripe credentials.
  if (typeof stripeProductId === 'string' && stripeProductId.startsWith('_test_')) {
    const bemId = stripeProductId.slice('_test_'.length);
    const product = config.payment.products.find((p) => p.id === bemId);
    if (product) {
      return { id: product.id, name: product.name || product.id };
    }
    return { id: 'basic', name: 'Basic' };
  }

  for (const product of config.payment.products) {
    // Match current product ID
    if (product.stripe?.productId === stripeProductId) {
      return { id: product.id, name: product.name || product.id };
    }

    // Match legacy product IDs (pre-migration Stripe products)
    if (product.stripe?.legacyProductIds?.includes(stripeProductId)) {
      return { id: product.id, name: product.name || product.id };
    }
  }

  // No match found
  return { id: 'basic', name: 'Basic' };
}

/**
 * Resolve product for one-time payments by matching productId from metadata
 * Returns { id, name } — falls back to 'unknown' if no match is found
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
 * Resolve subscription expiration from Stripe data
 */
function resolveExpires(raw) {
  // Stripe API 2025+ moves period dates to items.data[0]
  const periodEndRaw = raw.current_period_end
    || raw.items?.data?.[0]?.current_period_end
    || 0;

  const periodEnd = periodEndRaw
    ? powertools.timestamp(new Date(periodEndRaw * 1000), { output: 'string' })
    : EPOCH_ZERO;

  return {
    timestamp: periodEnd,
    timestampUNIX: periodEnd !== EPOCH_ZERO
      ? powertools.timestamp(periodEnd, { output: 'unix' })
      : EPOCH_ZERO_UNIX,
  };
}

/**
 * Resolve subscription start date from Stripe data
 */
function resolveStartDate(raw) {
  const startDate = raw.start_date
    ? powertools.timestamp(new Date(raw.start_date * 1000), { output: 'string' })
    : EPOCH_ZERO;

  return {
    timestamp: startDate,
    timestampUNIX: startDate !== EPOCH_ZERO
      ? powertools.timestamp(startDate, { output: 'unix' })
      : EPOCH_ZERO_UNIX,
  };
}

/**
 * Resolve the display price for a product/frequency from config
 *
 * @param {string} productId - Product ID (e.g., 'premium')
 * @param {string} frequency - 'monthly', 'annually', or 'once'
 * @param {object} config - App config
 * @returns {number} Price amount (e.g., 4.99) or 0
 */
function resolvePrice(productId, frequency, config) {
  const product = config.payment?.products?.find(p => p.id === productId);

  if (!product || !product.prices) {
    return 0;
  }

  return product.prices[frequency] || 0;
}

module.exports = Stripe;
