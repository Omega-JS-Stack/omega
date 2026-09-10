const { oneTimeRefundRefusal } = require('../../../libraries/payment/refund-policy.js');

/**
 * GET /user/orders - The caller's own purchase history
 *
 * `payments-orders` is admin-only to clients (firestore.rules), and a one-time
 * purchase writes NOTHING to users/{uid} — so a browser could not see a one-time
 * purchase at all, while the confirmation copy and the receipt email both told
 * the customer to find it in their account
 * ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 *
 * This is the read path, server-side through the admin SDK: the rules stay as
 * they are (no collection is opened to clients), and the ownership filter below
 * is the whole authorization. A caller only ever reads their own orders unless
 * they are an admin asking about somebody else, the same shape
 * `GET /user/subscription` and `GET /user/sessions` use.
 */
module.exports = async ({ ctx, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Get target UID
  const uid = settings.uid;

  // Require admin to view other users' orders
  if (uid !== user.auth.uid && !user.roles.admin) {
    return ctx.respond('Admin required', { code: 403 });
  }

  // ONE equality filter, then the sort and the cut in JS: ordering in the query
  // would need an owner+created composite index, and a purchase history is a
  // handful of documents per account — this query has no business asking a brand
  // to deploy an index for it (the same call the abandoned-checkout journey's
  // webhook lookup makes).
  const snapshot = await admin.firestore()
    .collection('payments-orders')
    .where('owner', '==', uid)
    .get();

  const orders = snapshot.docs
    .map((doc) => summarize(doc.id, doc.data()))
    .sort((a, b) => b.date.timestampUNIX - a.date.timestampUNIX)
    .slice(0, settings.limit);

  ctx.log(`Orders for uid=${uid}: ${orders.length} of ${snapshot.size}`);

  return ctx.respond({ orders });
};

/**
 * What the account page is allowed to know about one order.
 *
 * A summary, deliberately: the order doc carries the provider's whole raw
 * resource, the request's IP and user agent, and the attribution that sold it.
 * None of that belongs in a browser — the page shows what was bought, when, for
 * how much, and what state it is in.
 *
 * @param {string} id - The payments-orders document id (the order id)
 * @param {object} order - The document data
 * @returns {object} The client-safe order summary
 */
function summarize(id, order) {
  const unified = order.unified || {};
  const payment = unified.payment || {};
  const refunded = !!order.requests?.refund || unified.status === 'refunded';

  return {
    id: order.id || id,
    type: order.type || 'subscription',
    productId: unified.product?.id || order.productId || null,
    productName: unified.product?.name || unified.product?.id || order.productId || null,
    // The purchase's own state, as the webhook pipeline last wrote it
    status: unified.status || 'unknown',
    refunded: refunded,
    // Whether the refund route would take this order — decided by the policy
    // module both sides read, never by a rule of this route's own
    refundable: !oneTimeRefundRefusal(order),
    amount: typeof payment.price === 'number' ? payment.price : null,
    currency: payment.currency || 'USD',
    frequency: payment.frequency || null,
    provider: payment.provider || order.provider || null,
    date: {
      timestamp: order.metadata?.created?.timestamp || null,
      timestampUNIX: order.metadata?.created?.timestampUNIX || 0,
    },
  };
}

// Exported for testing — the summary is this route's promise about what a
// browser may see, independent of who is asking
module.exports.summarize = summarize;
