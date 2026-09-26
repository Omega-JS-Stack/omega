const Stripe = require('./stripe.js');

/**
 * Test provider library
 * Delegates to Stripe's transformers since test provider generates Stripe-shaped data
 * Stamps provider as 'test' to distinguish from real Stripe data
 */
const Test = {
  /**
   * No-op init — test provider doesn't need an external SDK
   */
  init() {
    return null;
  },

  /**
   * Fetch resource — the test provider IS its own API
   *
   * The one library that may read the event body ([../fetch-failure.js](../fetch-failure.js)):
   * there is no test provider out there to ask, so its "API records" are the
   * emulator's own payments-orders plus the body the event carried. A REAL
   * provider never reads it — that is the trust rule this seam enforces
   * ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)) — and the route
   * refuses `provider=test` in production, so nothing outside a test run reaches here.
   *
   * When the requested resourceType doesn't match the event's own resource (e.g.,
   * requesting a subscription but the event carries an invoice from
   * invoice.payment_failed), look up the existing resource from Firestore instead
   * of returning mismatched data.
   */
  async fetchResource(resourceType, resourceId, context) {
    const eventResource = this.extractResource(context?.raw) || {};

    // If the event's resource matches the requested type AND has a UID, return it directly
    // When UID is missing (e.g., PAYMENT.SALE events), fall through to Firestore lookup
    // so we can reconstruct a resource with the UID from the order's owner field
    if (eventResource.object === resourceType && eventResource.metadata?.uid) {
      return eventResource;
    }

    // Look up the existing resource from payments-orders in Firestore
    // This simulates what a real API call (Stripe/PayPal) would return — a resource
    // with the full metadata including UID
    const admin = context?.admin;
    if (admin && resourceId) {
      const snapshot = await admin.firestore()
        .collection('payments-orders')
        .where('resourceId', '==', resourceId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        // payments-orders stores the unified subscription inside .unified
        // Reconstruct a Stripe-shaped object from the unified data for toUnifiedSubscription()
        if (resourceType === 'subscription' && data.unified) {
          const reconstructed = buildStripeSubscriptionFromUnified(data.unified, resourceId, context?.eventType, context?.config, data.owner);

          // If the event's resource matched the type but lacked UID, overlay its new
          // state onto the reconstructed resource, but keep the reconstructed metadata (has uid)
          if (eventResource.object === resourceType) {
            return { ...eventResource, metadata: { ...eventResource.metadata, ...reconstructed.metadata } };
          }

          return reconstructed;
        }

        // The same reconstruction on the one-time side: a session/invoice webhook
        // that carries no metadata (no uid, no orderId) is answered from the order
        // the first webhook already wrote
        if (data.type === 'one-time' && data.unified) {
          const reconstructed = buildStripeOneTimeFromOrder(data, resourceId);

          // Keep the event's fresh state, take the metadata only the order has
          if (Object.keys(eventResource).length > 0) {
            return { ...eventResource, metadata: { ...eventResource.metadata, ...reconstructed.metadata } };
          }

          return reconstructed;
        }
      }
    }

    // Last resort: the event's own resource is all this provider has
    return eventResource;
  },

  /**
   * Extract the resource the webhook envelope carries — delegates to Stripe
   * (test provider uses Stripe-shaped data), and is where its own fetchResource
   * reads the event body it answers from
   */
  extractResource(raw) {
    return Stripe.extractResource(raw);
  },

  /**
   * Extract orderId — delegates to Stripe (test provider uses Stripe-shaped data)
   */
  getOrderId(resource) {
    return Stripe.getOrderId(resource);
  },

  /**
   * Extract UID — delegates to Stripe (test provider uses Stripe-shaped data)
   */
  getUid(resource) {
    return Stripe.getUid(resource);
  },

  /**
   * Refund details — Stripe's reader over the charge this provider has
   *
   * The test provider IS its own API ([../fetch-failure.js](../fetch-failure.js)),
   * so the charge of record is whichever one it already holds: the fetched
   * resource when the event resolved to the charge itself, otherwise the event's
   * own body. Never a real Stripe lookup — there is no Stripe account behind a
   * test-provider event to answer one
   * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
   */
  async getRefundDetails(resource, options = {}) {
    const charge = resource?.object === 'charge'
      ? resource
      : this.extractResource(options.raw);

    return Stripe.toRefundDetails(charge);
  },

  /**
   * Transform raw subscription into unified shape
   * Delegates to Stripe's toUnifiedSubscription (same data shape), stamps provider as 'test'
   */
  toUnifiedSubscription(rawSubscription, options) {
    const unified = Stripe.toUnifiedSubscription(rawSubscription, options);
    unified.payment.provider = 'test';
    return unified;
  },

  /**
   * Transform raw one-time payment into unified shape
   * Delegates to Stripe's toUnifiedOneTime, stamps provider as 'test'
   */
  toUnifiedOneTime(rawResource, options) {
    const unified = Stripe.toUnifiedOneTime(rawResource, options);
    unified.payment.provider = 'test';
    return unified;
  },
};

module.exports = Test;

/**
 * Reconstruct a Stripe-shaped subscription from the unified subscription stored in Firestore
 * This is only needed for the test provider when the webhook fallback doesn't match the resource type
 * (e.g., invoice.payment_failed sends invoice data but we need the subscription)
 *
 * The unified → Stripe mapping must produce data that toUnifiedSubscription() can process correctly.
 * For payment failure events, we override the status to past_due so it maps to 'suspended'.
 */
function buildStripeSubscriptionFromUnified(unified, resourceId, eventType, config, ownerUid) {
  // Map unified status back to a Stripe status
  const STATUS_MAP = {
    active: 'active',
    suspended: 'past_due',
    cancelled: 'canceled',
  };

  // Map unified frequency back to Stripe interval
  const INTERVAL_MAP = {
    monthly: 'month',
    annually: 'year',
    weekly: 'week',
    daily: 'day',
  };

  // Determine status: for payment failure events, force past_due regardless of current state
  // In production, Stripe would have already updated the subscription status
  let status = STATUS_MAP[unified.status] || 'active';
  if (eventType === 'invoice.payment_failed') {
    status = 'past_due';
  }

  // Resolve the Stripe product ID from config
  // This is needed for resolveProduct() in toUnifiedSubscription() to match the correct product
  const frequency = unified.payment?.frequency;
  const productId = unified.product?.id;
  const stripeProductId = resolveStripeProductId(productId, config);

  return {
    id: resourceId,
    object: 'subscription',
    status: status,
    metadata: { orderId: unified.payment?.orderId || null, uid: ownerUid || null },
    plan: {
      product: stripeProductId,
      interval: INTERVAL_MAP[frequency] || 'month',
    },
    current_period_end: unified.expires?.timestampUNIX || 0,
    current_period_start: unified.payment?.startDate?.timestampUNIX || 0,
    start_date: unified.payment?.startDate?.timestampUNIX || 0,
    cancel_at_period_end: unified.cancellation?.pending || false,
    cancel_at: unified.cancellation?.pending ? unified.cancellation?.date?.timestampUNIX : null,
    canceled_at: null,
    trial_start: unified.trial?.claimed ? (unified.payment?.startDate?.timestampUNIX || 0) : null,
    trial_end: unified.trial?.claimed ? (unified.trial?.expires?.timestampUNIX || 0) : null,
  };
}

/**
 * Reconstruct a Stripe-shaped one-time resource from the order stored in Firestore
 *
 * The one-time twin of buildStripeSubscriptionFromUnified(): what a real API call
 * would return for a session/invoice — most importantly the metadata (uid, orderId,
 * productId) that a bare webhook payload may not carry.
 */
function buildStripeOneTimeFromOrder(order, resourceId) {
  const unified = order.unified || {};

  return {
    id: resourceId,
    object: 'checkout.session',
    status: unified.status === 'completed' ? 'complete' : unified.status || 'complete',
    metadata: {
      orderId: unified.payment?.orderId || order.id || null,
      uid: order.owner || null,
      productId: unified.product?.id || order.productId || null,
    },
  };
}

/**
 * Look up the Stripe product ID from config given a product ID
 * e.g., ('plus') → 'prod_plus'
 */
function resolveStripeProductId(productId, config) {
  if (!productId || !config?.payment?.products) {
    return null;
  }

  const product = config.payment.products.find(p => p.id === productId);

  if (!product) {
    return null;
  }

  // Real Stripe product ID if configured, otherwise the "_test_<id>" sentinel that the
  // Stripe resolver recognizes and maps back to the @omega.js/backend product. Lets reconstruction
  // work in brands without real Stripe (Somiibo uses PayPal, Chargebee, etc.).
  return product.stripe?.productId || `_test_${product.id}`;
}
