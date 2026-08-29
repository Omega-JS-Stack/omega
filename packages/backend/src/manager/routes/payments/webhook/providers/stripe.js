/**
 * Stripe webhook provider
 * Extracts and categorizes webhook event data from Stripe
 *
 * Each event is mapped to a category (subscription or one-time) and includes
 * the resource type + ID needed to fetch the latest state from Stripe's API.
 */

// Invoice events, successful and failed. A renewal produces NO subscription
// transition (active → active, same product), so the invoice event is the only
// thing that tells the pipeline money moved — without it Stripe recurring
// revenue never reaches analytics ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
//
// `invoice.paid` is deliberately NOT here. Stripe fires it alongside
// `invoice.payment_succeeded` for the same paid invoice, and the analytics
// resolver treats every renewal-shaped webhook as its own payment — ingesting
// both would report a renewal's revenue TWICE. `invoice.payment_succeeded` is
// the narrower of the two (a payment attempt actually succeeded), so it is the
// one that carries renewals. A brand must send `invoice.payment_succeeded`:
// `invoice.paid` is rejected at the route (`isSupported`) and never stored.
const INVOICE_EVENTS = new Set([
  'invoice.payment_failed',
  'invoice.payment_succeeded',
]);

// Events we process, mapped to their default category
// Some events (the invoice events, checkout.session.completed) require
// inspecting the payload to determine the actual category
const SUPPORTED_EVENTS = new Set([
  // Subscription lifecycle
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',

  // Invoice outcomes — renewals and failures (could be subscription or one-time)
  ...INVOICE_EVENTS,

  // Checkout completion (could be subscription or one-time)
  'checkout.session.completed',

  // Refunds
  'charge.refunded',
]);

module.exports = {
  /**
   * Returns true if this event type should be saved and processed
   */
  isSupported(eventType) {
    return SUPPORTED_EVENTS.has(eventType);
  },

  /**
   * Parse a Stripe webhook request
   * Extracts event data and determines category, resource type, resource ID, and UID
   *
   * @param {object} req - The raw HTTP request
   * @returns {object} { eventId, eventType, category, resourceType, resourceId, chargeId, raw, uid }
   *   - category: 'subscription' | 'one-time' | null (null = skip)
   *   - resourceType: 'subscription' | 'invoice' | 'session' | 'charge'
   *   - resourceId: ID to fetch from provider API
   *   - chargeId: THIS charge's own id, where a subscription event names one —
   *     Stripe's invoice id. The resourceId is the subscription, which is
   *     constant for its whole life, so it can never key a single charge
   *     ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
   */
  parseWebhook(req) {
    const event = req.body;

    // Validate event structure
    if (!event || !event.id || !event.type) {
      throw new Error('Invalid Stripe webhook payload');
    }

    const dataObject = event.data?.object || {};
    const eventType = event.type;

    // Resolve category, resource info, and UID based on event type
    let category = null;
    let resourceType = null;
    let resourceId = null;
    let uid = null;
    // The invoice this event is about, when it is about one. A one-time purchase
    // has exactly one charge and the order names it, so only the SUBSCRIPTION
    // branches fill this in ([#656]).
    let chargeId = null;

    if (eventType.startsWith('customer.subscription.')) {
      // Subscription lifecycle events — always subscription category
      category = 'subscription';
      resourceType = 'subscription';
      resourceId = dataObject.id;
      uid = dataObject.metadata?.uid || null;

    } else if (INVOICE_EVENTS.has(eventType)) {
      // Invoice outcome (renewal or failure) — inspect billing_reason to determine
      // category. A subscription invoice resolves to the SUBSCRIPTION it belongs
      // to, so the pipeline re-fetches live subscription state either way.
      const billingReason = dataObject.billing_reason || '';
      const subscriptionId = dataObject.parent?.subscription_details?.subscription
        || dataObject.subscription
        || null;

      if (billingReason.startsWith('subscription') && subscriptionId) {
        // Subscription-related invoice
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = subscriptionId;
        // The invoice IS the charge — one per renewal, recovery and conversion.
        chargeId = dataObject.id || null;
        uid = dataObject.parent?.subscription_details?.metadata?.uid
          || dataObject.subscription_details?.metadata?.uid
          || dataObject.metadata?.uid
          || null;
      } else {
        // One-time (manual) invoice
        category = 'one-time';
        resourceType = 'invoice';
        resourceId = dataObject.id;
        uid = dataObject.metadata?.uid || null;
      }

    } else if (eventType === 'checkout.session.completed') {
      const mode = dataObject.mode;

      if (mode === 'subscription') {
        // Subscription checkout — skip, subscription events handle this
        category = null;
      } else if (mode === 'payment') {
        // One-time payment checkout
        category = 'one-time';
        resourceType = 'session';
        resourceId = dataObject.id;
        uid = dataObject.metadata?.uid || null;
      }

    } else if (eventType === 'charge.refunded') {
      // Refund event — the charge object contains an invoice ID which links to a subscription
      const invoiceId = dataObject.invoice;
      const subscriptionId = dataObject.subscription
        || dataObject.metadata?.subscriptionId
        || null;

      if (subscriptionId) {
        // Subscription-related refund
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = subscriptionId;
        // The invoice the reversed charge was paid against, so the refund can
        // name the same id GA4 recorded that charge under ([#656]).
        chargeId = invoiceId || null;
      } else if (invoiceId) {
        // Has invoice — likely subscription-related, will resolve via fetchResource
        category = 'subscription';
        resourceType = 'invoice';
        resourceId = invoiceId;
        chargeId = invoiceId;
      } else {
        // One-time payment refund — no subscription, no invoice, so the charge
        // itself is the resource. Dropping it (category = null) meant the refund
        // of a one-time purchase never entered the pipeline at all
        // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
        category = 'one-time';
        resourceType = 'charge';
        resourceId = dataObject.id;
      }

      uid = dataObject.metadata?.uid || null;
    }

    return {
      eventId: event.id,
      eventType: eventType,
      category: category,
      resourceType: resourceType,
      resourceId: resourceId,
      chargeId: chargeId,
      raw: event,
      uid: uid,
    };
  },
};
