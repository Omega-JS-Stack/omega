const path = require('path');
const powertools = require('node-powertools');
const loadProcessor = require('../../../libraries/load-processor.js');
const winback = require('../../../libraries/payment/winback.js');
const isTrialing = require('../cancel/_is-trialing.js');

/**
 * POST /payments/winback
 * Applies the cancel-flow SAVE OFFER to the authenticated user's live
 * subscription, so the cancel they started never happens
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The offer is the brand's (`payment.winback` in omega.json5 — 50% off the next
 * cycle by default) and it reaches the processor as a discount, through the same
 * coupon plumbing a checkout discount code rides. The subscription itself does
 * not change: the customer keeps the plan, the cadence and the renewal date they
 * already had, and the next invoice is the only thing that moves — so this route
 * writes no subscription state, exactly like cancel and uncancel.
 *
 * Claimed ONCE per subscription: the claim is recorded on
 * payments-orders/{orderId}.requests.winback, which is also what a second call
 * is refused against (`offer-already-claimed`) — an offer that could be taken
 * every time the cancel dialog opens is a permanent discount nobody agreed to.
 * A subscription with no order doc has nowhere to record it, so it is refused
 * (`offer-not-claimable`) rather than handed an offer with no memory.
 *
 * Cross-provider and CAPABILITY-GATED, the same shape uncancel uses: a processor
 * that can discount a live subscription exports applyOffer(), one that cannot
 * simply lacks the export, and the route refuses before dispatch rather than
 * letting the caller discover it as a provider error
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
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
    return ctx.respond('Accepting the offer must be confirmed', { code: 400 });
  }

  // The brand's own offer. A brand that turned it off has no offer to apply, and
  // the client never shows the step — so a call arriving here is a stale page or
  // a hand-rolled request, and it is refused rather than given a default.
  const offer = winback.resolveOffer(ctx.Manager.config);

  if (!offer.enabled) {
    ctx.log(`Winback rejected: uid=${uid}, the save offer is disabled for this brand`);
    return ctx.respond('This offer is not available', { code: 400 });
  }

  const subscription = user.subscription;

  // Require an ACTIVE paid subscription — there is no next cycle to discount on
  // a suspended or already-ended one
  if (!subscription || subscription.status !== 'active' || subscription.product?.id === 'basic') {
    ctx.log(`Winback rejected: uid=${uid}, status=${subscription?.status}, product=${subscription?.product?.id}`);
    return ctx.respond('No active paid subscription found', { code: 400 });
  }

  // A TRIAL is never offered this: cancelling a trial ends access immediately
  // (#267) and nothing has been paid, so "off your next cycle" is not the offer
  // that state needs. The billing card gates the same way, off the same rule.
  if (isTrialing(subscription)) {
    ctx.log(`Winback rejected: uid=${uid}, subscription is still in its free trial`);
    return ctx.respond('This offer is not available on a free trial', { code: 400 });
  }

  // The offer is made BEFORE the questionnaire, so a subscription already
  // scheduled to end is past it. Undo cancellation is the honest verb there.
  if (subscription.cancellation?.pending === true) {
    ctx.log(`Winback rejected: uid=${uid}, cancellation already pending`);
    return ctx.respond('Your subscription is already scheduled to cancel', { code: 400 });
  }

  const processor = subscription.payment?.processor;
  const resourceId = subscription.payment?.resourceId;

  if (!processor || !resourceId) {
    ctx.log(`Winback rejected: uid=${uid}, missing processor=${processor} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // The capability gate. A missing export is the processor saying it cannot
  // discount a live subscription at all — a CLIENT fault to be branched on, not
  // an outage to retry, so the code rides the response properties where every
  // 4xx carries its machine-readable half, and the billing card retires the
  // offer and lets the cancel through on it.
  if (typeof processorModule.applyOffer !== 'function') {
    ctx.log(`Winback not supported: uid=${uid}, processor=${processor}`);
    return ctx.respond('Your payment provider cannot apply this offer. Please use the billing portal to manage your subscription.', {
      code: 400,
      additional: { code: 'not-supported-by-processor' },
    });
  }

  // One claim per subscription. The order doc is where the claim lives, so the
  // check reads the same document the write below lands on.
  //
  // No order doc, no claim — and an offer whose claim cannot be RECORDED is an
  // offer takeable every time the cancel dialog opens, each accept re-couponing
  // the subscription. A subscription can reach here without one (created in the
  // processor's dashboard, imported, a metadata backfill that never landed), so
  // it is refused before dispatch rather than handed an offer this route cannot
  // remember. The code rides the response properties the capability gate's does,
  // so the billing card branches on it and lets the cancel through. It is read
  // AFTER that gate: a processor that cannot discount at all is the more
  // permanent answer, and it costs no read.
  const orderId = subscription.payment?.orderId;

  if (!orderId) {
    ctx.log(`Winback rejected: uid=${uid}, the subscription carries no orderId to record the claim on`);
    return ctx.respond('This offer is not available on your subscription. Please use the billing portal to manage your subscription.', {
      code: 400,
      additional: { code: 'offer-not-claimable' },
    });
  }

  const admin = ctx.Manager.libraries.admin;
  const orderRef = admin.firestore().doc(`payments-orders/${orderId}`);
  const orderDoc = await orderRef.get();

  // A past claimant reaching the cancel flow again is pitched the offer anyway
  // — the client reads the ACCOUNT, which carries no claim — so this refusal
  // rides the same branchable code the two gates above do ([#310]). Without
  // one, accepting shows an error toast and leaves the dialog armed for a retry
  // that can never succeed; with it the billing card retires the offer and
  // opens the questionnaire, which is what the customer came for.
  if (orderDoc.exists && orderDoc.data().requests?.winback) {
    ctx.log(`Winback rejected: uid=${uid}, offer already claimed on payments-orders/${orderId}`);
    return ctx.respond('You have already claimed this offer', {
      code: 400,
      additional: { code: 'offer-already-claimed' },
    });
  }

  // The offer, in the shape every downstream reader already speaks
  const discount = winback.toDiscount(offer);

  try {
    await processorModule.applyOffer({ resourceId, uid, subscription, discount, ctx });
  } catch (e) {
    // The processor's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to apply the winback offer via ${processor}: uid=${uid}, sub=${resourceId}, error=${e.message}`);
    return ctx.respond('We could not apply your discount right now. Please try again shortly.', { code: 500 });
  }

  // Record the claim. This is the offer's whole memory: the refusal above reads
  // it, and it is what an analysis of the experiment counts accepts from.
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });

  await orderRef.set({
    requests: {
      winback: {
        discount: discount,
        date: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
    },
  }, { merge: true });

  ctx.log(`Stored winback claim on payments-orders/${orderId}: code=${discount.code}`);

  // The experiment's server-side half. The offer is measured against the
  // existing `subscription-winback` baseline (a returning subscriber the webhook
  // pipeline already reads as a purchase), so the ACCEPT is recorded where that
  // pipeline's events go — the client counts shown/declined, which never reach a
  // server at all.
  ctx.analytics.event('payments/winback', {
    code: discount.code,
    percent: discount.percent || null,
    amount: discount.amount || null,
    duration: discount.duration,
    payment_processor: processor,
    product_id: subscription.product?.id || null,
    payment_frequency: subscription.payment?.frequency || null,
  });

  ctx.log(`Winback offer applied: uid=${uid}, processor=${processor}, sub=${resourceId}, code=${discount.code}, duration=${discount.duration}`);

  return ctx.respond({ success: true, discount: discount });
};
