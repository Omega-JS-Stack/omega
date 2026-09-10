/**
 * Chargebee webhook provider
 * Extracts, validates, and categorizes webhook event data from Chargebee
 *
 * Chargebee webhook payload structure:
 * {
 *   id: "ev_xxx",
 *   occurred_at: 1234567890,
 *   event_type: "subscription_created",
 *   content: { subscription: {...}, customer: {...}, invoice: {...} }
 * }
 */

const ChargebeeLib = require('../../../../libraries/payment/providers/chargebee.js');

// Events we process — mapped to their category
const SUPPORTED_EVENTS = new Set([
  // Subscription lifecycle
  'subscription_created',
  'subscription_activated',
  'subscription_changed',
  'subscription_cancelled',
  'subscription_reactivated',
  'subscription_renewed',
  'subscription_cancellation_scheduled',
  'subscription_scheduled_cancellation_removed',
  'subscription_paused',
  'subscription_resumed',

  // Payment events
  'payment_succeeded',
  'payment_failed',
  'payment_refunded',

  // One-time (non-recurring invoice)
  'invoice_generated',
]);

// Events that are always subscription-related
const SUBSCRIPTION_EVENTS = new Set([
  'subscription_created',
  'subscription_activated',
  'subscription_changed',
  'subscription_cancelled',
  'subscription_reactivated',
  'subscription_renewed',
  'subscription_cancellation_scheduled',
  'subscription_scheduled_cancellation_removed',
  'subscription_paused',
  'subscription_resumed',
]);

module.exports = {
  /**
   * Returns true if this event type should be saved and processed
   */
  isSupported(eventType) {
    return SUPPORTED_EVENTS.has(eventType);
  },

  /**
   * Parse a Chargebee webhook request
   *
   * @param {object} req - The raw HTTP request
   * @returns {object} { eventId, eventType, category, resourceType, resourceId, chargeId, raw, uid }
   */
  parseWebhook(req) {
    const event = req.body;

    // Validate event structure
    if (!event || !event.id || !event.event_type) {
      throw new Error('Invalid Chargebee webhook payload');
    }

    const eventType = event.event_type;
    const content = event.content || {};
    const subscription = content.subscription;
    const invoice = content.invoice;
    const customer = content.customer;

    let category = null;
    let resourceType = null;
    let resourceId = null;
    let uid = null;
    // THIS charge's own id — Chargebee's invoice id, which rides the renewal and
    // refund payloads. The resourceId is the subscription, constant for its whole
    // life, so it can never key a single charge
    // ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)). A one-time
    // purchase has exactly one charge and the order names it.
    let chargeId = null;

    if (SUBSCRIPTION_EVENTS.has(eventType)) {
      // Subscription lifecycle events
      category = 'subscription';
      resourceType = 'subscription';
      resourceId = subscription?.id || null;
      // The RENEWAL's invoice, and only that one. `subscription_created` carries
      // an invoice too — the checkout's first one (test/fixtures/chargebee/
      // webhook-subscription-created.json) — but that charge is reported under
      // the ORDER id, the one id the confirmation page can compute as well
      // ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)). Naming it
      // here would have this hand the pipeline a charge id for an event whose
      // transaction is keyed on the order.
      chargeId = eventType === 'subscription_renewed' ? (invoice?.id || null) : null;
      uid = extractUid(subscription, customer);

    } else if (eventType === 'payment_succeeded') {
      // The paid signal. Note this routes the OPPOSITE way from payment_failed
      // below on the subscription branch: there, the state diff (active →
      // suspended) is what names the failure, so the doc has work to do. Here a
      // renewal's charge is already carried by `subscription_renewed` — the event
      // the analytics resolver reads as Chargebee's payment — so storing this one
      // too would book that revenue TWICE, the same double-count Stripe's provider
      // header documents for `invoice.paid` beside `invoice.payment_succeeded`.
      if (subscription) {
        category = null;
      } else {
        // A one-time purchase, and the only event that says it was actually PAID.
        // `invoice_generated` fires for the same purchase but an invoice is born
        // unpaid, so reading that as the sale would email a receipt to someone who
        // never paid ([#729](https://github.com/Omega-JS-Stack/omega/issues/729)).
        category = 'one-time';
        resourceType = 'invoice';
        resourceId = invoice?.id || null;
        uid = extractUid(null, customer);
      }

    } else if (eventType === 'payment_failed') {
      // Payment failure — subscription-related if subscription is present
      if (subscription) {
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = subscription.id;
        uid = extractUid(subscription, customer);
      } else {
        // One-time payment failure
        category = 'one-time';
        resourceType = 'invoice';
        resourceId = invoice?.id || null;
        uid = extractUid(null, customer);
      }

    } else if (eventType === 'payment_refunded') {
      // Refund — subscription-related if subscription is present
      if (subscription) {
        category = 'subscription';
        resourceType = 'subscription';
        resourceId = subscription.id;
        // The invoice the reversed charge was paid against ([#656]).
        chargeId = invoice?.id || null;
        uid = extractUid(subscription, customer);
      } else if (invoice) {
        // No subscription — the refund of a one-time purchase, resolved through
        // the invoice it refunded, the same one the one-time payment_failed branch
        // above names. Skipping it meant that refund never entered the pipeline at
        // all ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
        category = 'one-time';
        resourceType = 'invoice';
        resourceId = invoice.id;
        uid = extractUid(null, customer);
      } else {
        // Neither a subscription nor an invoice — nothing names the purchase
        category = null;
      }

    } else if (eventType === 'invoice_generated') {
      // Check if it's a non-recurring invoice (one-time purchase)
      if (invoice && !invoice.subscription_id) {
        category = 'one-time';
        resourceType = 'invoice';
        resourceId = invoice.id;
        uid = extractUid(null, customer);
      } else {
        // Recurring invoice — skip (subscription events handle this)
        category = null;
      }
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

/**
 * Extract UID from Chargebee subscription meta_data or customer
 * Tries subscription meta_data first, then customer meta_data, then cf_ fields
 *
 * @param {object|null} subscription - Chargebee subscription object
 * @param {object|null} customer - Chargebee customer object
 * @returns {string|null}
 */
function extractUid(subscription, customer) {
  // Try subscription meta_data
  if (subscription) {
    const uid = ChargebeeLib.getUid(subscription);
    if (uid) {
      return uid;
    }
  }

  // Try customer meta_data
  if (customer) {
    const uid = ChargebeeLib.getUid(customer);
    if (uid) {
      return uid;
    }
  }

  return null;
}
