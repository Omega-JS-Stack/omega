const path = require('path');
const powertools = require('node-powertools');
const loadProvider = require('../../../libraries/load-provider.js');
const { deliverConversion } = require('../../../libraries/analytics/conversions.js');
const { buildAttributionContext, buildIdentity } = require('../../../libraries/analytics/match-data.js');
// The payment webhook's analytics module owns what "still inside the trial" means
// for reporting, and this sweep reports the outcomes that webhook never sees — so
// both read the one predicate rather than keeping a copy each ([#407]).
const { isInsideTrial } = require('../../firestore/payments-webhooks/analytics.js');

const PROVIDERS_DIR = path.join(__dirname, '../../../libraries/payment/providers');

// The candidate window, at both edges.
//
// GRACE — a trial that ended within the last 24 hours is left alone. Webhook lag at
// trial end is normal, and PayPal's stored trial expiry is a COMPUTED ESTIMATE
// (PayPal fires no trial-end event), so acting the minute the stored date passes
// would cancel subscriptions the provider is about to confirm.
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
 * A trial that ends without converting should leave the user on basic. The providers
 * say so with a webhook — and when that webhook is missed or never fires, the user
 * keeps a paid product they never paid for. Nothing else notices: `trial.claimed`
 * means "this subscription HAD a trial", never "it converted", so a lapsed trial and
 * a converted one are indistinguishable on the user doc alone.
 *
 * So this asks the provider. Every candidate is CONFIRMED against live provider
 * state before anything is written — the sweep never infers a lapse from dates.
 *
 * Flow:
 * 1. Query users whose claimed trial expired inside the window and who are still active
 * 2. Skip the ones already stamped, on basic, or with no provider to ask
 * 3. Fetch the live subscription from the provider
 * 4. Provider says active  → the trial CONVERTED: stamp `trial.outcome` and nothing else
 *    Provider says gone or cancelled → the trial LAPSED: reset to basic + stamp
 *    Anything else (dunning) → leave it; the provider still has it
 * 5. Re-read before writing so a webhook that landed since the query is never clobbered
 * 6. Report the outcome to analytics — but ONLY when this sweep is the one that saw it
 *
 * No email is sent from here. The sweep is state correction — the customer-facing
 * message for a lapsed trial is its own piece of work.
 *
 * **Analytics.** For PayPal this sweep is the only place a trial outcome is ever
 * known: PayPal fires no trial-end event, so nothing in the webhook pipeline is told
 * and the funnel had no signal at all ([#407]). So the outcome is reported here, at
 * the moment it is stamped, through the same `deliverConversion` path the payment
 * webhook uses. The guard against double-counting is
 * `resolveTrialOutcomeConversion()` below.
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
    // provider is unreachable must not cost every user behind them in the batch.
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

      const provider = sub.payment?.provider;
      const resourceId = sub.payment?.resourceId;

      if (!provider || !resourceId) {
        ctx.log(`skip ${uid}: no provider to confirm with (provider=${provider || 'null'}, resourceId=${resourceId || 'null'})`);
        skipped++;
        continue;
      }

      let library;

      try {
        library = loadProvider(PROVIDERS_DIR, provider);
      } catch (e) {
        ctx.warn(`skip ${uid}: unknown provider library '${provider}' — nothing can confirm this trial`);
        skipped++;
        continue;
      }

      // Ask the provider. Its answer is the only thing this sweep acts on — a fetch
      // that cannot answer throws rather than handing back anything older.
      let live = null;

      try {
        live = await library.fetchResource('subscription', resourceId, { admin, ctx, config: Manager.config });
      } catch (e) {
        // A provider that cannot answer is not a provider saying "cancelled". Only
        // "no such subscription" means gone; everything else is transient and waits
        // for the next run rather than fabricating a cancellation.
        if (!e.notFound) {
          ctx.warn(`skip ${uid}: provider ${provider} could not confirm ${resourceId} (${e.message}) — retrying next run`);
          skipped++;
          continue;
        }
      }

      // No resource, or one with no status, is the provider saying it is gone
      const gone = !live || !live.status;
      const liveStatus = gone ? null : library.toUnifiedSubscription(live, { config: Manager.config }).status;

      let outcome;

      if (!gone && liveStatus === 'active') {
        outcome = 'converted';
      } else if (gone || liveStatus === 'cancelled') {
        outcome = 'lapsed';
      } else {
        // Dunning (suspended): the provider still holds the subscription and is still
        // trying. Neither outcome is true yet, so nothing is stamped and the next run
        // asks again.
        ctx.log(`skip ${uid}: provider ${provider} reports ${liveStatus} — no outcome yet`);
        skipped++;
        continue;
      }

      // The trial converted into a paid subscription: stamp the outcome and touch
      // NOTHING else — the subscription the user is paying for is correct as it is.
      // A lapse writes the same end state the cancel route does for a subscription
      // the provider no longer has: cancelled, back on basic, nothing pending.
      const write = outcome === 'converted'
        ? { subscription: { trial: { outcome: 'converted' } } }
        : {
          subscription: {
            status: 'cancelled',
            product: { id: 'basic', name: 'Basic' },
            cancellation: { pending: false, date: { timestamp: now, timestampUNIX: nowUNIX } },
            trial: { outcome: 'lapsed' },
          },
        };

      // Re-read and write in ONE transaction. The snapshot above is from the top of
      // the run; a webhook may have written this subscription since, and that write
      // is the newer truth — the sweep must never clobber it. As a bare read followed
      // by a separate set, a webhook landing BETWEEN the two was clobbered anyway:
      // the guard proved freshness at a moment that had already passed by the time
      // the write went out. A transaction re-runs the whole block when the document
      // changes under it, so the guard and the write see one state
      // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
      const result = await admin.firestore().runTransaction(async (transaction) => {
        const fresh = await transaction.get(doc.ref);
        const freshSub = fresh.data()?.subscription || {};
        const freshStampUNIX = freshSub.payment?.updatedBy?.date?.timestampUNIX || 0;

        if (isNewerThanSweep(freshStampUNIX, sweepReadUNIX)) {
          return { skipped: `a newer subscription write landed (updatedBy=${freshStampUNIX} >= read=${sweepReadUNIX})` };
        }

        if (freshSub.status !== 'active' || freshSub.trial?.outcome) {
          return { skipped: `no longer a candidate (status=${freshSub.status}, outcome=${freshSub.trial?.outcome || 'null'})` };
        }

        transaction.set(doc.ref, write, { merge: true });

        return { userData: fresh.data() || {}, sub: freshSub };
      });

      if (result.skipped) {
        ctx.log(`skip ${uid}: ${result.skipped}`);
        skipped++;
        continue;
      }

      if (outcome === 'converted') {
        ctx.log(`convert ${uid}: provider ${provider} reports the subscription is active, trial.outcome=converted`);
        trackOutcome({ outcome, uid, userData: result.userData, sub: result.sub, Manager, ctx });
        converted++;
        continue;
      }

      ctx.log(`lapse ${uid}: provider ${provider} reports ${gone ? 'the subscription is gone' : liveStatus}, reset to basic, trial.outcome=lapsed`);
      trackOutcome({ outcome, uid, userData: result.userData, sub: result.sub, Manager, ctx });
      lapsed++;
    } catch (e) {
      ctx.error(`Failed to sweep ${uid}: ${e.message}`);
      failed++;
    }
  }

  ctx.log(`Completed! (${lapsed} lapsed, ${converted} converted, ${skipped} skipped, ${failed} failed)`);
};

/**
 * Has a subscription write landed since this sweep read its candidates?
 *
 * `>=`, not `>`. Both numbers are whole SECONDS, so a webhook that wrote inside the
 * same second the sweep took its snapshot carries an EQUAL stamp — and a strict `>`
 * read that as older and let the sweep write over it, which is precisely the write
 * the guard exists to protect (a provider's own trial-end event resolving the trial
 * while the backstop was mid-run). Equal reads as newer: the cost of being wrong is
 * one candidate re-examined on the next run, against a subscription silently
 * reverted to a state the provider had already moved past.
 *
 * @param {number} freshStampUNIX - `subscription.payment.updatedBy.date.timestampUNIX`, 0 when never stamped
 * @param {number} sweepReadUNIX - The second this run read its candidate snapshot
 * @returns {boolean} True when the sweep's answer is stale and must not be written
 */
function isNewerThanSweep(freshStampUNIX, sweepReadUNIX) {
  return (freshStampUNIX || 0) >= sweepReadUNIX;
}

/**
 * The conversion to report for an outcome this sweep just decided, or null when the
 * outcome was already reported at the moment it happened.
 *
 * THE GUARD IS THE TERM. A conversion a payment webhook already saw moved `expires`
 * out past the trial's end, and a lapse it saw left the subscription suspended or
 * cancelled — which this sweep's own query (`status == active`) never selects. So a
 * candidate still inside its trial is exactly one no webhook has resolved, and it is
 * the only one this backstop has anything new to say about.
 *
 * The subscription-keyed event id collapses a genuine race on the two platforms that
 * key on an event id; this guard is what keeps GA4 honest, because GA4 deduplicates
 * a `purchase` on `transaction_id` alone — and this path has no invoice to name, so
 * a conversion reported twice would arrive under two different ids and count twice
 * ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
 *
 * Which makes this the ONE documented exception to "`transaction_id` is a charge's
 * id, never the subscription's": this path has no invoice to name, and the outcome
 * stamp keeps it to one fire (docs/shared/analytics.md).
 *
 * The subscription passed in is the one read BEFORE the lapse write — the paid
 * product that lapsed, not the `basic` the sweep resets it to.
 *
 * @param {object} sub - The subscription as it stood before this sweep wrote
 * @param {string} outcome - 'converted' | 'lapsed'
 * @param {string} currency - The brand's payment currency
 * @returns {{ event: string, eventId: string, params: object }|null}
 */
function resolveTrialOutcomeConversion(sub, outcome, currency) {
  if (!isInsideTrial(sub)) {
    return null;
  }

  const event = outcome === 'converted' ? 'trial_convert' : 'trial_lapse';
  // The full price: a conversion the provider made without telling us leaves no
  // invoice here to read a discount off, and the plan price is the honest number
  // this path can actually stand behind.
  const price = parseFloat(sub.payment?.price || 0);

  return {
    event: event,
    eventId: `${event}.${sub.payment?.resourceId}`,
    params: {
      transaction_id: sub.payment?.resourceId,
      value: price,
      currency: currency,
      items: [{
        item_id: sub.product?.id,
        item_name: sub.product?.name,
        price: price,
        quantity: 1,
      }],
      payment_provider: sub.payment?.provider,
      payment_frequency: sub.payment?.frequency || null,
      is_trial: true,
      is_recurring: false,
    },
  };
}

/**
 * Report a trial outcome this sweep decided (non-blocking, never throws at the sweep)
 *
 * @param {object} options
 * @param {string} options.outcome - 'converted' | 'lapsed'
 * @param {string} options.uid - The owner
 * @param {object} options.userData - The user doc (attribution + consent + match data)
 * @param {object} options.sub - The subscription as it stood before the write
 * @param {object} options.Manager - The backend Manager
 * @param {object} options.ctx - The event context
 */
function trackOutcome({ outcome, uid, userData, sub, Manager, ctx }) {
  try {
    const conversion = resolveTrialOutcomeConversion(sub, outcome, Manager.config.payment?.currency || 'USD');

    if (!conversion) {
      ctx.log(`skip analytics ${uid}: the term has moved past the trial end (expires=${sub.expires?.timestampUNIX || 'null'}, trial.expires=${sub.trial?.expires?.timestampUNIX || 'null'})`);
      return;
    }

    deliverConversion({
      ...conversion,
      attribution: buildAttributionContext(userData.attribution),
      // The whole doc, read by the ONE match reader (#577)
      identity: buildIdentity({ uid: uid, user: userData }),
      trackingConsent: userData.trackingConsent,
      ctx: ctx,
      Manager: Manager,
    });
  } catch (e) {
    ctx.error(`Trial outcome tracking failed for ${uid}: ${e.message}`, e);
  }
}

// The sweep IS the module; these ride alongside it for the pipeline and the tests.
module.exports.resolveTrialOutcomeConversion = resolveTrialOutcomeConversion;
module.exports.isNewerThanSweep = isNewerThanSweep;
