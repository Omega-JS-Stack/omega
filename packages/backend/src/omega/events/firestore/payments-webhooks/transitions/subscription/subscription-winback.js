/**
 * Transition: subscription-winback
 * Triggered when a fully cancelled subscriber resubscribes (cancelled paid → active paid)
 *
 * The customer's email is the same order confirmation a first subscription sends —
 * same template, same computed totals — so it is sent by the SAME handler rather
 * than a second copy of it here. Only the log line names the win-back.
 */
const newSubscription = require('./new-subscription.js');

module.exports = async function (context) {
  const { before, after, uid, ctx } = context;

  ctx.log(`Transition [subscription/subscription-winback]: uid=${uid}, product=${after.product?.id}, previousProduct=${before?.product?.id}, frequency=${after.payment?.frequency}`);

  return newSubscription(context);
};
