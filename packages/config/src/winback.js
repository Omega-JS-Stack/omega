/**
 * winback.js — the cancel-flow save offer, resolved once
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * When a customer starts cancelling, the billing card pitches a discount on the
 * next cycle before it asks them why they are leaving. What that offer IS is the
 * brand's call (Ian, 2026-08-15: "the offer must be CONFIGURABLE in omega.json5,
 * offer content/numbers per brand, not hardcoded"), and a brand that writes
 * nothing at all still makes one: 50% off the next cycle, one cycle only.
 *
 * That default lives HERE and nowhere else. The backend's apply route resolves
 * `Manager.config.payment` through this function, and the web build bakes the
 * SAME call into the client blob it emits — so the dialog the customer reads and
 * the coupon the provider creates can never disagree about the number.
 *
 * The offer's shape mirrors a discount code exactly (see the backend's
 * libraries/payment/discount-codes.js): percent-based OR amount-based, never
 * both, and the absent shape is OMITTED rather than set to undefined, because a
 * resolved offer is written into Firestore on the order doc and firebase-admin
 * refuses a document carrying an undefined value.
 *
 * `enabled` is the whole off switch and it defaults ON: the offer exists for
 * every brand until one turns it off (`payment.winback.enabled: false`). A
 * disabled offer still RESOLVES its numbers — one shape for every caller, one
 * flag to read — it is simply never made.
 */

// What a brand that configures nothing gets. `duration: 'once'` is the next
// cycle only; 'forever' is the brand asking for a permanent price cut.
const WINBACK_OFFER_DEFAULTS = { enabled: true, percent: 50, duration: 'once' };

// The durations a coupon can be built for on every provider that supports the
// offer. Stripe's third option ('repeating') needs a duration_in_months beside
// it, which is provider surface nothing here asks for.
const WINBACK_DURATIONS = ['once', 'forever'];

/**
 * The save offer a `payment` section makes, with the framework default applied.
 *
 * @param {object} [payment] - The resolved config's `payment` section.
 * @returns {{ enabled: boolean, percent?: number, amount?: number, duration: string }}
 */
function resolveWinbackOffer(payment) {
  const configured = (payment && payment.winback) || {};

  // A brand naming an amount is making an amount offer, and it carries no
  // percent at all — not even the default one, which would otherwise ride along
  // and give a provider two shapes to choose between.
  const shape = typeof configured.amount === 'number'
    ? { amount: configured.amount }
    : { percent: typeof configured.percent === 'number' ? configured.percent : WINBACK_OFFER_DEFAULTS.percent };

  return {
    enabled: configured.enabled !== false,
    ...shape,
    duration: configured.duration || WINBACK_OFFER_DEFAULTS.duration,
  };
}

module.exports = { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS, WINBACK_DURATIONS };
