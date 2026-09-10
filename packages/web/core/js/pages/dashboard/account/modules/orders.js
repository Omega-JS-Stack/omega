// The account's purchase history: ONE fetch per page load, read by both the
// Orders list and the Refund form.
//
// `payments-orders` is admin-only to clients and a one-time purchase writes
// nothing to `users/{uid}`, so the browser has no way to see one except through
// this route ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
import omega from '@omega.js/client';

// The in-flight (or settled) request. Two sections ask for the same history in
// the same breath — the account page loads every section's data at once — and
// the answer does not change between them.
let pending = null;

// The order the customer picked "Request a refund" on, held from the click in
// the Orders list until the Refund section is on screen. A section cannot write
// into another section's controls while it is still `d-none`, and the two must
// not learn each other's DOM: this is the whole handoff.
let refundIntent = null;

/**
 * The caller's own orders, newest first.
 *
 * @param {object} [options]
 * @param {boolean} [options.refresh] - Ask the server again (after a refund went through)
 * @returns {Promise<object[]>} The order summaries the route hands back
 */
export function fetchOrders({ refresh = false } = {}) {
  if (refresh) {
    pending = null;
  }

  pending ||= omega.request(`${omega.getApiUrl()}/omega/user/orders`, {
    method: 'GET',
    timeout: 30000,
    tries: 2,
  })
    .then((response) => response?.orders || [])
    .catch((error) => {
      // A failed history is not a page failure: the sections that read it say so
      // themselves. Clearing the memo lets the next section retry.
      pending = null;
      throw error;
    });

  return pending;
}

/**
 * The orders the backend's refund lane would accept, newest first.
 *
 * `refundable` is the BACKEND's answer (libraries/payment/refund-policy.js), so
 * a button offered here is a refund that route takes.
 *
 * @param {object[]} orders - The summaries fetchOrders() handed back
 * @returns {object[]}
 */
export function refundableOrders(orders) {
  return (orders || []).filter((order) => order.refundable === true);
}

/**
 * Remember which order the customer wants refunded.
 *
 * @param {string} orderId - The order id
 */
export function requestRefundFor(orderId) {
  refundIntent = orderId;
}

/**
 * Take the pending refund pick, if there is one. Reading it clears it: the
 * choice belongs to the click that made it, never to the next visit.
 *
 * @returns {string|null}
 */
export function takeRefundRequest() {
  const orderId = refundIntent;

  refundIntent = null;

  return orderId;
}
