/**
 * PayPal winback provider — DELIBERATELY EMPTY.
 *
 * PayPal has no coupon or discount object at all. A subscription's price is the
 * PLAN's price, and the only ways to change what a subscriber pays next are to
 * revise them onto a different plan (which is a plan switch, not a one-cycle
 * discount, and would leave them there) or to write a one-off pricing scheme
 * onto the plan itself — which would move every subscriber on it. Neither is the
 * offer, and neither rides plumbing that already exists here: the checkout's
 * discount codes have never reached PayPal either
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The module exports NOTHING on purpose: the capability gate in ../post.js reads
 * `typeof providerModule.applyOffer === 'function'`, so the absent export IS the
 * declaration, and the caller gets a `not-supported-by-provider` 400 that the
 * billing card turns into "the offer is retired, here is the questionnaire"
 * rather than a dead dialog ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The file still has to EXIST: without it the route would answer "Unknown
 * provider", which is a different (and wrong) statement about PayPal.
 */
module.exports = {};
