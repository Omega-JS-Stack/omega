/**
 * Transition: purchase-refunded
 * Triggered when a one-time purchase is refunded (charge.refunded with no
 * subscription and no invoice).
 *
 * Webhook-driven, so it fires however the refund originated — the refund
 * endpoint, an admin dashboard, or a direct provider action.
 *
 * Provider-agnostic — refund details are extracted by the provider library's
 * getRefundDetails() and passed as a unified { amount, currency, reason } object,
 * the same ones on-write.js records on the order.
 *
 * NOTE: No email template exists for a refunded one-time purchase yet, so this
 * only logs — the same stub shape purchase-failed.js uses. The subscription twin
 * (subscription/payment-refunded.js) sends the 'order'/'refunded' email.
 */
module.exports = async function ({ before, after, order, uid, userDoc, ctx, refundDetails }) {
  ctx.log(`Transition [one-time/purchase-refunded]: uid=${uid}, orderId=${order?.id}, product=${after?.product?.id}, amount=${refundDetails?.amount || 'unknown'} ${refundDetails?.currency || 'USD'}, reason=${refundDetails?.reason || 'none'}`);

  // TODO: Send a one-time refund email once a template exists
};
