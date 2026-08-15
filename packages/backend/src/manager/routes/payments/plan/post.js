const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');

/**
 * POST /payments/plan
 * Moves the authenticated user's LIVE subscription to a different plan — another
 * product, another billing frequency, or both — without cancelling and
 * re-subscribing. Delegates to the processor (e.g., Stripe) to swap the price on
 * the existing subscription. The resulting webhook triggers the Firestore pipeline
 * which updates subscription state and fires the plan-changed transition handler.
 * This route writes no subscription state of its own, exactly like cancel.
 * Requires authentication.
 *
 * Cross-provider and CAPABILITY-GATED: a processor that can move a live
 * subscription exports switchPlan(), one that cannot simply lacks the export, and
 * the route refuses before dispatch rather than letting the caller discover it as
 * a provider error ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A switch NEVER grants, resets, or extends a trial (Ian 2026-08-14,
 * [#237](https://github.com/Omega-JS-Stack/omega/issues/237)): a mid-trial switch
 * carries the trial over — same original end date, new plan. The route writes no
 * state, so each processor's switchPlan() is what preserves it through the swap.
 */
module.exports = async ({ ctx, Manager, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  const uid = user.auth.uid;
  const productId = settings.productId;
  const frequency = settings.frequency;

  // Require explicit confirmation
  if (!settings.confirmed) {
    return ctx.respond('Plan change must be confirmed', { code: 400 });
  }

  const subscription = user.subscription;

  // Require an active paid subscription — there is nothing to move otherwise
  if (!subscription || subscription.status !== 'active' || subscription.product?.id === 'basic') {
    ctx.log(`Plan change rejected: uid=${uid}, status=${subscription?.status}, product=${subscription?.product?.id}`);
    return ctx.respond('No active paid subscription found', { code: 400 });
  }

  // A cancellation already in flight is a decision of its own. The processors
  // swap the PRICE, never the schedule, so a switch here would land the caller
  // on a new plan still set to end at period end — silently. Undo the
  // cancellation first; that is the honest button ([#237]).
  if (subscription.cancellation?.pending === true) {
    ctx.log(`Plan change rejected: uid=${uid}, cancellation pending`);
    return ctx.respond('Your subscription is scheduled to cancel. Undo the cancellation before changing plans.', {
      code: 400,
      additional: { code: 'cancellation-pending' },
    });
  }

  // Validate the target product against the brand's own config — the same
  // resolution the intent route does, over the same products array
  const product = (Manager.config.payment?.products || []).find(p => p.id === productId);

  if (!product) {
    ctx.log(`Plan change rejected: uid=${uid}, product "${productId}" not found (available: ${(Manager.config.payment?.products || []).map(p => p.id).join(', ')})`);
    return ctx.respond(`Product '${productId}' not found`, { code: 400 });
  }

  const productType = product.type || 'subscription';

  // A subscription can only move to another subscription plan
  if (productType !== 'subscription' || productId === 'basic') {
    ctx.log(`Plan change rejected: uid=${uid}, target product=${productId} is type=${productType}`);
    return ctx.respond(`Product '${productId}' is not a subscription plan`, { code: 400 });
  }

  // The target has to be a plan the brand actually sells at that frequency —
  // catching it here keeps a client-fault input from surfacing as a 500 out of
  // the processor's price lookup
  if (!product.prices?.[frequency]) {
    ctx.log(`Plan change rejected: uid=${uid}, no ${frequency} price for product=${productId}`);
    return ctx.respond(`Product '${productId}' is not sold ${frequency}`, { code: 400 });
  }

  // The switch has to BE a switch: same product at the same frequency is a
  // no-op, and dispatching one costs a real processor call and a real webhook.
  // The guard lives HERE and never leans on the client's own filtering — the
  // modal's filter silently misses when the recorded frequency is absent
  // ([#236]), and the trial the no-op switch used to end was real.
  //
  // An UNRECORDED current frequency refuses the whole product: `'monthly' ===
  // undefined` is false, so a pair comparison alone would sail the no-op through
  // to a real processor call — the exact state the QA repro was in. Both cadences
  // are refused until the backend records one, mirroring the modal's own
  // conservatism ([#236]).
  const currentProductId = subscription.product?.id;
  const currentFrequency = subscription.payment?.frequency;

  if (productId === currentProductId && (!currentFrequency || frequency === currentFrequency)) {
    ctx.log(`Plan change rejected: uid=${uid}, already on product=${productId}, frequency=${frequency} (current frequency: ${currentFrequency || 'unrecorded'})`);
    return ctx.respond('You are already on that plan', {
      code: 400,
      additional: { code: 'already-on-plan' },
    });
  }

  const processor = subscription.payment?.processor;
  const resourceId = subscription.payment?.resourceId;

  if (!processor || !resourceId) {
    ctx.log(`Plan change rejected: uid=${uid}, missing processor=${processor} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // The capability gate. A missing export is the processor saying it cannot do
  // this at all — a CLIENT fault to be branched on, not an outage to retry, so
  // the code rides the response properties where every 4xx carries its
  // machine-readable half, and the sentence points at the fallback that works.
  if (typeof processorModule.switchPlan !== 'function') {
    ctx.log(`Plan change not supported: uid=${uid}, processor=${processor}`);
    return ctx.respond('Your payment provider cannot change plans here. Please use the billing portal to manage your subscription.', {
      code: 400,
      additional: { code: 'not-supported-by-processor' },
    });
  }

  // Swap the plan via the processor
  try {
    await processorModule.switchPlan({ resourceId, uid, subscription, product, productType, frequency, ctx });
  } catch (e) {
    // The processor's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to change plan via ${processor}: uid=${uid}, sub=${resourceId}, product=${productId}, frequency=${frequency}, error=${e.message}`);
    return ctx.respond('We could not change your plan right now. Please try again shortly.', { code: 500 });
  }

  ctx.log(`Plan change requested: uid=${uid}, processor=${processor}, sub=${resourceId}, ${currentProductId}/${currentFrequency} → ${productId}/${frequency}`);

  return ctx.respond({ success: true });
};
