/**
 * PayPal webhook provider
 * Extracts, validates, and categorizes webhook event data from PayPal
 *
 * PayPal webhook events: https://developer.paypal.com/api/rest/webhooks/event-names/
 *
 * No verifySignature() yet, so these events are gated by `?key=` alone. PayPal's
 * scheme (POST /v1/notifications/verify-webhook-signature with the PAYPAL-*
 * transmission headers) needs the WEBHOOK ID of the endpoint the event arrived
 * on — @omega.js/manager's payment service creates that endpoint and knows the
 * id, but nothing plumbs it to the backend (no config field, no env var). TODO:
 * carry the id into the backend's environment, then verify here.
 */

// Events we process, mapped to their category
const SUPPORTED_EVENTS = new Set([
  // Subscription lifecycle
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',

  // Payment events (subscription billing)
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.DENIED',
  'PAYMENT.SALE.REFUNDED',

  // One-time order events
  'CHECKOUT.ORDER.APPROVED',

  // v2 capture refunds. One-time purchases this framework creates go through
  // v2 Orders, and a v2 capture refunds as PAYMENT.CAPTURE.REFUNDED — never the
  // v1 PAYMENT.SALE.REFUNDED above, so this list used to drop every refund of a
  // modern PayPal purchase ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
  //
  // The siblings stay OUT, reviewed with the same issue: CAPTURE.COMPLETED /
  // PENDING / DENIED describe the capture this framework performs itself inside
  // fetchResource('order'), so accepting them would process one purchase twice.
  // CAPTURE.REVERSED is a money-out event like a refund, but nothing here has
  // ever exercised it — it needs its own payload before it is accepted.
  'PAYMENT.CAPTURE.REFUNDED',
]);

module.exports = {
  /**
   * Returns true if this event type should be saved and processed
   */
  isSupported(eventType) {
    return SUPPORTED_EVENTS.has(eventType);
  },

  /**
   * Parse a PayPal webhook request
   * Extracts event data and determines category, resource type, resource ID, and UID
   *
   * @param {object} req - The raw HTTP request
   * @returns {object} { eventId, eventType, category, resourceType, resourceId, raw, uid }
   */
  parseWebhook(req) {
    const event = req.body;

    // Validate event structure
    if (!event || !event.id || !event.event_type) {
      throw new Error('Invalid PayPal webhook payload');
    }

    const resource = event.resource || {};
    const eventType = event.event_type;

    let category = null;
    let resourceType = null;
    let resourceId = null;
    let uid = null;

    if (eventType.startsWith('BILLING.SUBSCRIPTION.')) {
      // Subscription lifecycle events
      category = 'subscription';
      resourceType = 'subscription';
      resourceId = resource.id; // PayPal subscription ID (I-xxx)

      // Parse uid from custom_id
      uid = parseUidFromCustomId(resource.custom_id);

    } else if (eventType === 'PAYMENT.SALE.COMPLETED' || eventType === 'PAYMENT.SALE.DENIED') {
      // Payment sale — determine if it's for a subscription
      const billingAgreementId = resource.billing_agreement_id;

      if (billingAgreementId) {
        // Subscription payment
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = billingAgreementId; // This is the subscription ID

        uid = parseUidFromCustomId(resource.custom_id);
      } else {
        // One-time payment — skip for now (not yet supported)
        category = null;
      }

    } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      // One-time order approved by buyer — will be captured in fetchResource
      category = 'one-time';
      resourceType = 'order';
      resourceId = resource.id; // PayPal order ID

      // Parse uid from purchase_units custom_id
      uid = parseUidFromCustomId(resource.purchase_units?.[0]?.custom_id);

    } else if (eventType === 'PAYMENT.SALE.REFUNDED') {
      // Refund — linked to a subscription via billing_agreement_id
      const billingAgreementId = resource.billing_agreement_id;

      if (billingAgreementId) {
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = billingAgreementId;
      } else {
        // No billing agreement behind it — this is the refund of a one-time
        // purchase, and the sale it reversed is the resource the event carries.
        // Dropping it (category = null) meant that refund never entered the
        // pipeline at all — the Stripe twin of this gap
        // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
        category = 'one-time';
        resourceType = 'sale';
        resourceId = resource.sale_id || resource.id;
      }

      uid = parseUidFromCustomId(resource.custom_id);

    } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      // The v2 twin of the branch above: a one-time purchase made through v2
      // Orders refunds as a capture refund. The resource is a v2 Refund, which
      // names the CAPTURE it reversed through its HATEOAS `up` link — there is
      // no parent_payment to walk, and the capture reads back at
      // /v2/payments/captures/{id} carrying our custom_id directly
      // ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
      category = 'one-time';
      resourceType = 'capture';
      resourceId = resource.capture_id || parseCaptureIdFromLinks(resource.links) || resource.id;

      uid = parseUidFromCustomId(resource.custom_id);
    }

    return {
      eventId: event.id,
      eventType: eventType,
      category: category,
      resourceType: resourceType,
      resourceId: resourceId,
      raw: event,
      uid: uid,
    };
  },
};

/**
 * The capture id a v2 Refund's HATEOAS links name.
 *
 * PayPal v2 resources point UP at what they came from: a refund's `up` link is
 * the capture it reversed. Only a link that is actually a captures endpoint
 * counts — the same `up` rel names the ORDER on other resources.
 * @param {Array} links - The resource's `links` array
 * @returns {string|null} The capture id, or null when no link names one
 */
function parseCaptureIdFromLinks(links) {
  for (const link of links || []) {
    const match = String(link?.href || '').match(/\/v2\/payments\/captures\/([^/?#]+)/);

    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Parse uid from PayPal custom_id format: uid:{uid},orderId:{orderId}
 * @param {string} customId
 * @returns {string|null}
 */
function parseUidFromCustomId(customId) {
  if (!customId) {
    return null;
  }

  for (const part of customId.split(',')) {
    const [key, ...valueParts] = part.split(':');

    if (key === 'uid') {
      return valueParts.join(':') || null;
    }
  }

  return null;
}
