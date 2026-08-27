/**
 * The ONE rule that says a refund record belongs to the event that named it.
 *
 * A refund's numbers come from the provider, looked up by an id the payload
 * carried ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)). That id is
 * as trusted as the resourceId every lookup starts from — with one difference the
 * trust argument missed: a resourceId is SELF-CONSISTENT (whatever it names is
 * what gets fetched and what gets written), while a refund id imports numbers
 * ACROSS records. Pair a real sale of your own with an unrelated refund id from
 * the same merchant account and another customer's refund amount lands on your
 * order, their email and their refund conversion
 * ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)).
 *
 * So every refund lookup is linked back. Each provider knows its own back-pointer
 * — a PayPal v1 refund names its `sale_id` and a v2 refund links `up` to its
 * capture, a Chargebee credit note names its `subscription_id` /
 * `reference_invoice_id`, a Stripe charge carries the subscription and the uid it
 * was made under — and hands the pair here, so the DECISION is written once:
 *
 * - **disagrees** — the record is about another order. Thrown as
 *   `refundNotLinked`, which the pipeline refuses and acknowledges (the #509
 *   shape): nothing is written, and the stamp on the event's own doc is what a
 *   human reconciles from.
 * - **agrees** — proceed.
 * - **nothing to compare** — the record carries no back-pointer for this kind of
 *   resource (a PayPal subscription refund names the sale, never the billing
 *   agreement). Unprovable is not the same as wrong, so it proceeds — and the log
 *   line saying so is the only warning a human gets that this one refund was
 *   never cross-checked, exactly like the #509 uid fallback.
 */

/**
 * Assert that a looked-up refund record points back at the event's resource
 *
 * @param {object} options
 * @param {string} options.provider - Provider name (e.g. 'paypal')
 * @param {string} options.refundType - What was looked up ('refund', 'credit_note', 'charge', 'transaction')
 * @param {string} options.refundId - The id it was looked up by
 * @param {string|null} options.field - The record's back-pointer field, named as the provider spells it
 * @param {string|null} options.found - What that field says the record belongs to
 * @param {string|null} options.expected - What the event says it should belong to
 * @param {string} options.resourceType - The event's resource type
 * @param {string} options.resourceId - The event's resource id
 * @param {object} [options.ctx] - Assistant instance for logging
 * @throws {Error} Carrying `refundNotLinked` when the record belongs to something else
 */
function assertRefundLinkage({ provider, refundType, refundId, field, found, expected, resourceType, resourceId, ctx }) {
  if (!field || !found || !expected) {
    const message = `REFUND LINK UNPROVEN: ${provider} ${refundType} ${refundId} carries no ${field || 'back-pointer'} to check against ${resourceType} ${resourceId}, so this refund's numbers are recorded without being linked back to the resource the event named`;

    if (ctx?.warn) {
      ctx.warn(message);
    } else {
      console.warn(`[@omega.js/backend:payment:refund-linkage] ${message}`);
    }

    return;
  }

  if (found === expected) {
    return;
  }

  const failure = new Error(`${provider} ${refundType} ${refundId} names ${field} ${found}, but the ${resourceType} ${resourceId} this event is about is ${expected} — the refund belongs to another record`);

  failure.refundNotLinked = true;
  failure.provider = provider;
  failure.refundType = refundType;
  failure.refundId = refundId;
  failure.field = field;
  failure.linkedTo = found;
  failure.resourceType = resourceType;
  failure.resourceId = resourceId;

  throw failure;
}

module.exports = assertRefundLinkage;
