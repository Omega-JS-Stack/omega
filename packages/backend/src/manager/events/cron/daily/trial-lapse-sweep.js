const path = require('path');
const powertools = require('node-powertools');
const loadProcessor = require('../../../libraries/load-processor.js');
const isAlreadyGone = require('../../../routes/payments/cancel/_processor-errors.js');

const PROCESSORS_DIR = path.join(__dirname, '../../../libraries/payment/processors');

// The candidate window, at both edges.
//
// GRACE — a trial that ended within the last 24 hours is left alone. Webhook lag at
// trial end is normal, and PayPal's stored trial expiry is a COMPUTED ESTIMATE
// (PayPal fires no trial-end event), so acting the minute the stored date passes
// would cancel subscriptions the processor is about to confirm.
//
// FLOOR — a trial that ended more than 30 days ago ages out of the sweep. This is a
// BACKSTOP for missed webhooks, not the primary path (Stripe and Chargebee fire real
// events at trial end); without a floor every trial ever claimed is re-examined for
// the life of the brand.
const GRACE_SECONDS = 24 * 60 * 60;
const FLOOR_SECONDS = 30 * 24 * 60 * 60;

// Bounded per run. The window keeps the set small on its own; this is the ceiling.
const SWEEP_LIMIT = 200;

/**
 * Trial lapse sweep
 *
 * A trial that ends without converting should leave the user on basic. The processors
 * say so with a webhook — and when that webhook is missed or never fires, the user
 * keeps a paid product they never paid for. Nothing else notices: `trial.claimed`
 * means "this subscription HAD a trial", never "it converted", so a lapsed trial and
 * a converted one are indistinguishable on the user doc alone.
 *
 * So this asks the processor. Every candidate is CONFIRMED against live processor
 * state before anything is written — the sweep never infers a lapse from dates.
 *
 * Flow:
 * 1. Query users whose claimed trial expired inside the window and who are still active
 * 2. Skip the ones already stamped, on basic, or with no processor to ask
 * 3. Fetch the live subscription from the processor
 * 4. Processor says active  → the trial CONVERTED: stamp `trial.outcome` and nothing else
 *    Processor says gone or cancelled → the trial LAPSED: reset to basic + stamp
 *    Anything else (dunning) → leave it; the processor still has it
 * 5. Re-read before writing so a webhook that landed since the query is never clobbered
 *
 * No email is sent from here. The sweep is state correction — the customer-facing
 * message for a lapsed trial is its own piece of work.
 */
module.exports = async ({ Manager, ctx, context, libraries }) => {
  const { admin } = libraries;

  // The read stamp: any subscription write newer than this landed AFTER our snapshot,
  // which means a webhook has since spoken and this sweep's answer is stale.
  const now = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(now, { output: 'unix' });
  const sweepReadUNIX = nowUNIX;

  const ceilingUNIX = nowUNIX - GRACE_SECONDS;
  const floorUNIX = nowUNIX - FLOOR_SECONDS;

  ctx.log(`Checking for lapsed trials (expired between ${floorUNIX} and ${ceilingUNIX})...`);

  const snapshot = await admin.firestore()
    .collection('users')
    .where('subscription.trial.claimed', '==', true)
    .where('subscription.status', '==', 'active')
    .where('subscription.trial.expires.timestampUNIX', '>=', floorUNIX)
    .where('subscription.trial.expires.timestampUNIX', '<=', ceilingUNIX)
    .limit(SWEEP_LIMIT)
    .get();

  if (snapshot.empty) {
    ctx.log('No expired trials to check');
    return;
  }

  ctx.log(`Sweeping ${snapshot.size} expired trial(s)...`);

  let lapsed = 0;
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snapshot.docs) {
    const uid = doc.id;

    // Per-candidate isolation, like the runner's per-job isolation: one user whose
    // processor is unreachable must not cost every user behind them in the batch.
    try {
      const sub = doc.data().subscription || {};

      // Already answered — the outcome is stamped once and never revisited
      if (sub.trial?.outcome) {
        ctx.log(`skip ${uid}: trial already stamped ${sub.trial.outcome}`);
        skipped++;
        continue;
      }

      // Nothing to lapse — basic IS the lapsed end state
      if (sub.product?.id === 'basic') {
        ctx.log(`skip ${uid}: already on basic`);
        skipped++;
        continue;
      }

      const processor = sub.payment?.processor;
      const resourceId = sub.payment?.resourceId;

      if (!processor || !resourceId) {
        ctx.log(`skip ${uid}: no processor to confirm with (processor=${processor || 'null'}, resourceId=${resourceId || 'null'})`);
        skipped++;
        continue;
      }

      let library;

      try {
        library = loadProcessor(PROCESSORS_DIR, processor);
      } catch (e) {
        ctx.warn(`skip ${uid}: unknown processor library '${processor}' — nothing can confirm this trial`);
        skipped++;
        continue;
      }

      // Ask the processor. The empty fallback is deliberate: a stale webhook payload
      // is exactly what this sweep must NOT act on, so a fetch that cannot answer
      // throws instead of handing back the payload we already have.
      let live = null;

      try {
        live = await library.fetchResource('subscription', resourceId, {}, { admin, ctx, config: Manager.config });
      } catch (e) {
        // A processor that cannot answer is not a processor saying "cancelled". Only
        // "no such subscription" means gone; everything else is transient and waits
        // for the next run rather than fabricating a cancellation.
        if (!isAlreadyGone(e)) {
          ctx.warn(`skip ${uid}: processor ${processor} could not confirm ${resourceId} (${e.message}) — retrying next run`);
          skipped++;
          continue;
        }
      }

      // No resource, or one with no status, is the processor saying it is gone
      const gone = !live || !live.status;
      const liveStatus = gone ? null : library.toUnifiedSubscription(live, { config: Manager.config }).status;

      let outcome;

      if (!gone && liveStatus === 'active') {
        outcome = 'converted';
      } else if (gone || liveStatus === 'cancelled') {
        outcome = 'lapsed';
      } else {
        // Dunning (suspended): the processor still holds the subscription and is still
        // trying. Neither outcome is true yet, so nothing is stamped and the next run
        // asks again.
        ctx.log(`skip ${uid}: processor ${processor} reports ${liveStatus} — no outcome yet`);
        skipped++;
        continue;
      }

      // Re-read immediately before writing. The snapshot above is from the top of the
      // run; a webhook may have written this subscription since, and that write is the
      // newer truth — the sweep must never clobber it.
      const fresh = await doc.ref.get();
      const freshSub = fresh.data()?.subscription || {};
      const freshStampUNIX = freshSub.payment?.updatedBy?.date?.timestampUNIX || 0;

      if (freshStampUNIX > sweepReadUNIX) {
        ctx.log(`skip ${uid}: a newer subscription write landed (updatedBy=${freshStampUNIX} > read=${sweepReadUNIX})`);
        skipped++;
        continue;
      }

      if (freshSub.status !== 'active' || freshSub.trial?.outcome) {
        ctx.log(`skip ${uid}: no longer a candidate (status=${freshSub.status}, outcome=${freshSub.trial?.outcome || 'null'})`);
        skipped++;
        continue;
      }

      if (outcome === 'converted') {
        // The trial converted into a paid subscription. Stamp the outcome and touch
        // NOTHING else — the subscription the user is paying for is correct as it is.
        await doc.ref.set({ subscription: { trial: { outcome: 'converted' } } }, { merge: true });

        ctx.log(`convert ${uid}: processor ${processor} reports the subscription is active, trial.outcome=converted`);
        converted++;
        continue;
      }

      // The trial lapsed. Same end state the cancel route writes for a subscription the
      // processor no longer has: cancelled, back on basic, nothing pending.
      await doc.ref.set({
        subscription: {
          status: 'cancelled',
          product: { id: 'basic', name: 'Basic' },
          cancellation: { pending: false, date: { timestamp: now, timestampUNIX: nowUNIX } },
          trial: { outcome: 'lapsed' },
        },
      }, { merge: true });

      ctx.log(`lapse ${uid}: processor ${processor} reports ${gone ? 'the subscription is gone' : liveStatus}, reset to basic, trial.outcome=lapsed`);
      lapsed++;
    } catch (e) {
      ctx.error(`Failed to sweep ${uid}: ${e.message}`);
      failed++;
    }
  }

  ctx.log(`Completed! (${lapsed} lapsed, ${converted} converted, ${skipped} skipped, ${failed} failed)`);
};
