const path = require('path');
const loadProvider = require('../../../libraries/load-provider.js');
const powertools = require('node-powertools');

// Payments older than this are not eligible for a refund, whatever was bought.
const REFUND_WINDOW_SECONDS = 6 * 30 * 24 * 60 * 60;
const OUTSIDE_WINDOW_MESSAGE = 'Payments older than 6 months are not eligible for refunds';

/**
 * POST /payments/refund
 * Refunds a purchase. Two subjects, one endpoint:
 *
 * - No `orderId` — the authenticated user's SUBSCRIPTION. Refunds the latest
 *   payment and cancels immediately; requires the subscription to be cancelled or
 *   pending cancellation first.
 * - With `orderId` — a ONE-TIME purchase, named by its payments-orders doc. A
 *   one-time purchase never touches the user doc, so the order IS the subject
 *   ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * Delegates to the provider (e.g., Stripe) to issue the refund. The resulting
 * webhook triggers the Firestore pipeline, which fires the matching transition
 * handler (subscription-cancelled / purchase-refunded).
 * Stores the refund reason/feedback on payments-orders/{orderId}.requests.refund.
 * Requires authentication.
 */
module.exports = async ({ ctx, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  const uid = user.auth.uid;
  const confirmed = settings.confirmed;

  // Require explicit confirmation
  if (!confirmed) {
    return ctx.respond('Refund must be confirmed', { code: 400 });
  }

  // A named order is a one-time purchase — its own subject, its own guards
  if (settings.orderId) {
    return refundOneTimePurchase({ ctx, uid, settings });
  }

  const subscription = user.subscription;

  // Require a paid subscription
  if (!subscription || subscription.product?.id === 'basic') {
    ctx.log(`Refund rejected: uid=${uid}, no paid subscription`);
    return ctx.respond('No paid subscription found', { code: 400 });
  }

  // Require cancelled or pending cancellation — cannot refund an active subscription
  const isCancelled = subscription.status === 'cancelled';
  const isPendingCancel = subscription.cancellation?.pending === true;

  if (!isCancelled && !isPendingCancel) {
    ctx.log(`Refund rejected: uid=${uid}, status=${subscription.status}, pending=${subscription.cancellation?.pending}`);
    return ctx.respond('Subscription must be cancelled or pending cancellation before requesting a refund', { code: 400 });
  }

  // Reject if the most recent payment is older than 6 months
  const startDateUNIX = subscription.payment?.startDate?.timestampUNIX
    || subscription.payment?.updatedBy?.date?.timestampUNIX;

  if (!isWithinRefundWindow(startDateUNIX)) {
    ctx.log(`Refund rejected: uid=${uid}, payment too old (startDate=${new Date(startDateUNIX * 1000).toISOString()})`);
    return ctx.respond(OUTSIDE_WINDOW_MESSAGE, { code: 400 });
  }

  const provider = subscription.payment?.provider;
  const resourceId = subscription.payment?.resourceId;

  if (!provider || !resourceId) {
    ctx.log(`Refund rejected: uid=${uid}, missing provider=${provider} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the provider module
  let providerModule;
  try {
    providerModule = loadProvider(path.join(__dirname, 'providers'), provider);
  } catch (e) {
    return ctx.respond(`Unknown provider: ${provider}`, { code: 400 });
  }

  // Process the refund via the provider
  let refund;
  try {
    refund = await providerModule.processRefund({ resourceId, uid, subscription, ctx });
  } catch (e) {
    // The provider's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to process refund via ${provider}: uid=${uid}, sub=${resourceId}, error=${e.message}`);
    return ctx.respond('We could not process your refund right now. Please try again shortly.', { code: 500 });
  }

  // Store refund reason/feedback on the order doc
  const orderId = subscription.payment?.orderId;

  if (orderId) {
    await storeRefundRequest({ ctx, orderId, refund, settings });
  }

  ctx.log(`Refund processed: uid=${uid}, provider=${provider}, sub=${resourceId}, amount=${refund.amount}, full=${refund.full}, reason=${settings.reason}`);

  return ctx.respond({ success: true, refund });
};

/**
 * Refund a ONE-TIME purchase, named by its payments-orders doc.
 *
 * The subject is the order, not the user doc: a one-time purchase writes nothing
 * to users/{uid}.subscription, so there is no subscription state to check and
 * nothing to cancel — the purchase is either refundable or it is not.
 *
 * @param {object} options
 * @param {object} options.ctx - RouteContext
 * @param {string} options.uid - The caller's UID
 * @param {object} options.settings - Resolved request settings
 */
async function refundOneTimePurchase({ ctx, uid, settings }) {
  const admin = ctx.Manager.libraries.admin;
  const orderId = settings.orderId;

  const orderSnap = await admin.firestore().doc(`payments-orders/${orderId}`).get();
  const order = orderSnap.exists ? orderSnap.data() : null;

  // Missing and not-yours answer identically: an order id must never be a probe
  // for whether somebody else's purchase exists
  if (!order || order.owner !== uid) {
    ctx.log(`Refund rejected: uid=${uid}, orderId=${orderId}, exists=${orderSnap.exists}, owner=${order?.owner || 'null'}`);
    return ctx.respond('Order not found', { code: 400 });
  }

  if (order.type !== 'one-time') {
    ctx.log(`Refund rejected: uid=${uid}, orderId=${orderId}, type=${order.type}`);
    return ctx.respond('That order is not a one-time purchase', { code: 400 });
  }

  // requests.refund covers the in-app path; unified.status covers a refund issued
  // from the provider dashboard, which arrives by webhook and writes no request
  if (order.requests?.refund || order.unified?.status === 'refunded') {
    ctx.log(`Refund rejected: uid=${uid}, orderId=${orderId}, already refunded (request=${!!order.requests?.refund}, status=${order.unified?.status})`);
    return ctx.respond('This purchase has already been refunded', { code: 400 });
  }

  // The purchase date is the order's creation; the last webhook write is the fallback
  const purchasedUNIX = order.metadata?.created?.timestampUNIX
    || order.unified?.payment?.updatedBy?.date?.timestampUNIX;

  if (!isWithinRefundWindow(purchasedUNIX)) {
    ctx.log(`Refund rejected: uid=${uid}, orderId=${orderId}, purchase too old (created=${new Date(purchasedUNIX * 1000).toISOString()})`);
    return ctx.respond(OUTSIDE_WINDOW_MESSAGE, { code: 400 });
  }

  const provider = order.provider || order.unified?.payment?.provider;
  const resourceId = order.resourceId || order.unified?.payment?.resourceId;

  if (!provider || !resourceId) {
    ctx.log(`Refund rejected: uid=${uid}, orderId=${orderId}, missing provider=${provider} or resourceId=${resourceId}`);
    return ctx.respond('Order payment details not found', { code: 400 });
  }

  // Load the provider module
  let providerModule;
  try {
    providerModule = loadProvider(path.join(__dirname, 'providers'), provider);
  } catch (e) {
    return ctx.respond(`Unknown provider: ${provider}`, { code: 400 });
  }

  // Process the refund via the provider
  let refund;
  try {
    refund = await providerModule.processOneTimeRefund({ resourceId, uid, order, ctx });
  } catch (e) {
    // The provider's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to process one-time refund via ${provider}: uid=${uid}, orderId=${orderId}, resource=${resourceId}, error=${e.message}`);
    return ctx.respond('We could not process your refund right now. Please try again shortly.', { code: 500 });
  }

  await storeRefundRequest({ ctx, orderId, refund, settings });

  ctx.log(`One-time refund processed: uid=${uid}, provider=${provider}, orderId=${orderId}, resource=${resourceId}, amount=${refund.amount}, reason=${settings.reason}`);

  return ctx.respond({ success: true, refund });
}

/**
 * Store the refund reason/feedback on the order doc.
 *
 * ONE shape for both subjects — the refund record on an order must not differ
 * depending on which branch wrote it.
 *
 * @param {object} options
 * @param {object} options.ctx - RouteContext
 * @param {string} options.orderId - The payments-orders id
 * @param {object} options.refund - What the provider returned ({ amount, currency, full })
 * @param {object} options.settings - Resolved request settings (reason, feedback)
 */
async function storeRefundRequest({ ctx, orderId, refund, settings }) {
  const admin = ctx.Manager.libraries.admin;
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  await admin.firestore().doc(`payments-orders/${orderId}`).set({
    requests: {
      refund: {
        reason: settings.reason || null,
        feedback: settings.feedback || null,
        amount: refund.amount,
        full: refund.full,
        date: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
    },
  }, { merge: true });

  ctx.log(`Stored refund request on payments-orders/${orderId}: reason=${settings.reason}, amount=${refund.amount}`);
}

/**
 * Is a payment recent enough to refund? An absent date cannot disqualify one.
 *
 * @param {number} [paidUNIX] - When the payment happened
 * @returns {boolean}
 */
function isWithinRefundWindow(paidUNIX) {
  if (!paidUNIX) {
    return true;
  }

  return paidUNIX >= Math.floor(Date.now() / 1000) - REFUND_WINDOW_SECONDS;
}
