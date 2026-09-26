/**
 * Is this subscription still INSIDE its free trial?
 *
 * The cancel flow asks this in two places and both have to agree, so it is one
 * function rather than a copy per caller ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)):
 *
 * - the route waives the 24-hour young-subscription guard for a trial (that
 *   guard exists for settlement games on a PAID subscription; a trial has no
 *   payment to settle, and a same-day trial cancel is the most common trial
 *   behavior there is), and
 * - every provider cancels a trial NOW instead of at period end — Ian's ruling
 *   (2026-08-15): we do not keep serving a trial we know will not convert.
 *
 * The test: the trial is claimed, the subscription is live, and the subscription
 * still expires exactly when the TRIAL does. That last clause is what makes a
 * CONVERTED trial read false — conversion moves `expires` out to the end of the
 * first paid period while `trial.expires` stays where it was, so the two stop
 * matching the moment real money is involved.
 *
 * A trial that has run out but has not been swept yet still reads true, which is
 * the answer this flow wants: nothing was ever paid, so there is nothing to let
 * ride to a period end.
 *
 * The expiry has to EXIST to match. The three providers this was folded out of
 * compared the two timestamps directly, so a subscription carrying neither one
 * matched itself on `undefined` and read as trialing — harmless while the answer
 * only chose a cancel mode, but this now also waives a guard, and a guard must
 * never be waived by missing data.
 *
 * @param {object} [subscription] - The user's subscription object
 * @returns {boolean}
 */
module.exports = function isTrialing(subscription) {
  const trialExpires = subscription?.trial?.expires?.timestampUNIX;

  return !!(subscription?.trial?.claimed
    && subscription?.status === 'active'
    && trialExpires
    && trialExpires === subscription?.expires?.timestampUNIX);
};
