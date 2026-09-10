/**
 * Coinbase Commerce webhook provider
 * Extracts and categorizes webhook event data from Coinbase Commerce
 *
 * Coinbase Commerce events: https://docs.cdp.coinbase.com/commerce-onchain/docs/webhooks
 *
 * The delivery is authenticated by the ONE `?key=` check every payment webhook
 * rides (Ian 2026-08-27, with [#634](https://github.com/Omega-JS-Stack/omega/issues/634)).
 * Coinbase signs its deliveries with an `X-CC-Webhook-Signature` header and this
 * framework does NOT verify it — there is no per-provider signature layer left
 * anywhere in the payment system, and the body is trusted for identifiers only:
 * every value that drives state comes from the charge the pipeline looks up.
 */

// Events we process, mapped to their category. Every Coinbase Commerce event is
// about a CHARGE, and a charge is a single payment — there is no subscription,
// plan or billing agreement in this API at all, so nothing here can ever reach
// the pipeline's subscription half ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
//
// The siblings stay OUT, and each for its own reason: `charge:created` is our
// OWN intent call answering, not a payment, and processing it would write an
// order for a checkout nobody has paid for; `charge:delayed` and
// `charge:resolved` are the two halves of the underpaid/overpaid lane, where
// what the customer gets is a MERCHANT decision — they need that decision
// specified before an event can act on one, the same rule that keeps PayPal's
// CAPTURE.REVERSED out of its list.
const SUPPORTED_EVENTS = new Set([
  'charge:confirmed',
  'charge:pending',
  'charge:failed',
]);

module.exports = {
  /**
   * Returns true if this event type should be saved and processed
   */
  isSupported(eventType) {
    return SUPPORTED_EVENTS.has(eventType);
  },

  /**
   * Parse a Coinbase Commerce webhook request
   * Extracts event data and determines category, resource type, resource ID, and UID
   *
   * @param {object} req - The raw HTTP request
   * @returns {object} { eventId, eventType, category, resourceType, resourceId, chargeId, refundId, raw, uid }
   */
  parseWebhook(req) {
    const body = req.body;
    const event = body?.event;

    // Validate event structure
    if (!event || !event.id || !event.type) {
      throw new Error('Invalid Coinbase Commerce webhook payload');
    }

    const charge = event.data || {};
    const eventType = event.type;

    let category = null;
    let resourceType = null;
    let resourceId = null;
    let chargeId = null;

    if (SUPPORTED_EVENTS.has(eventType)) {
      // Every supported event is a charge event, and a charge is one purchase
      category = 'one-time';
      resourceType = 'charge';
      // The endpoint reads either identifier, and the id is the stable one — a
      // code is the short human-facing handle on the hosted page
      resourceId = charge.id || charge.code || null;
      // A one-time purchase has exactly ONE charge, and this is it: the same id
      // the money event is deduplicated on ([#656](https://github.com/Omega-JS-Stack/omega/issues/656))
      chargeId = resourceId;
    }

    return {
      eventId: event.id,
      eventType: eventType,
      category: category,
      resourceType: resourceType,
      resourceId: resourceId,
      chargeId: chargeId,
      // Coinbase Commerce has no refund API and publishes no refund event, so no
      // coinbase delivery is ever about money going back
      refundId: null,
      raw: body,
      uid: charge.metadata?.uid || null,
    };
  },
};
