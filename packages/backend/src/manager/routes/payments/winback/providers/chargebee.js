/**
 * Chargebee winback provider — DELIBERATELY EMPTY, for now.
 *
 * Chargebee DOES have coupons, and the checkout already creates them
 * (resolveChargebeeCoupon in routes/payments/intent/providers/chargebee.js).
 * What it has no existing plumbing for is attaching one to a subscription that
 * is already running: the only verb this framework drives on a live Chargebee
 * subscription is `update_for_items`, which REPLACES the subscription's items
 * with whatever is sent (see the plan-switch provider). Carrying a coupon
 * through it would mean reading the live item set back and restating it on every
 * offer — a re-pricing risk taken for a discount — and any other route to it is
 * provider surface nothing here has proven
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * So Chargebee declares the capability it has today, which is none. The module
 * exports NOTHING on purpose: the gate in ../post.js reads
 * `typeof providerModule.applyOffer === 'function'`, the caller gets a
 * `not-supported-by-provider` 400, and the billing card retires the offer and
 * opens the questionnaire — a Chargebee subscriber can always still cancel.
 *
 * The file still has to EXIST: without it the route would answer "Unknown
 * provider", which is a different (and wrong) statement about Chargebee.
 */
module.exports = {};
