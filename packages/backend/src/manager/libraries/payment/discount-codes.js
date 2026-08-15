/**
 * Discount codes — SSOT for all promo codes
 *
 * Each code maps to a discount definition. A code is EITHER percent-based or
 * amount-based — the two shapes Stripe's coupons come in:
 *   - percent: Percentage off (1-100) — Stripe's `percent_off`
 *   - amount: Flat dollars off — Stripe's `amount_off` (which is CENTS on
 *     Stripe's side; every builder converts)
 *   - duration: 'once' (first payment only)
 *   - eligible: Optional function (user) => boolean. If present, the code is only
 *     valid for users who pass this check. Receives the raw user doc or User instance.
 *     If omitted, the code is valid for everyone.
 */
const User = require('../../helpers/user.js');

const DISCOUNT_CODES = {
  // Website (displayed on pricing page, landing pages — no eligibility restrictions)
  'WELCOME15': { percent: 15, duration: 'once' },
  'SAVE10': { percent: 10, duration: 'once' },
  'FLASH20': { percent: 20, duration: 'once' },
  'GIFT15': { percent: 15, duration: 'once' },
  'WELCOME10OFF': { amount: 10, duration: 'once' },

  // Email campaigns (used by recurring sale seeds — restricted by audience)
  'UPGRADE15': {
    percent: 15,
    duration: 'once',
    eligible: (user) => {
      const sub = User.resolveSubscription(user);
      return sub.plan === 'basic';
    },
  },
  'COMEBACK20': {
    percent: 20,
    duration: 'once',
    eligible: (user) => {
      const sub = User.resolveSubscription(user);
      return sub.plan === 'basic' && user.subscription?.trial?.claimed === true;
    },
  },
  'MISSYOU25': {
    percent: 25,
    duration: 'once',
    eligible: (user) => {
      const sub = User.resolveSubscription(user);
      return sub.everPaid && user.subscription?.status === 'cancelled';
    },
  },
  'TRYAGAIN10': {
    percent: 10,
    duration: 'once',
    eligible: (user) => {
      return user.subscription?.status === 'cancelled';
    },
  },
};

/**
 * Validate a discount code, optionally checking user eligibility.
 *
 * @param {string} code - The discount code (case-insensitive)
 * @param {object} [user] - User doc or User instance. If provided and the code has
 *   an eligible() function, eligibility is checked. If not provided, eligibility is skipped.
 * @returns {{ valid: boolean, code: string, percent?: number, amount?: number, duration?: string, reason?: string }}
 */
function validate(code, user) {
  const normalized = (code || '').trim().toUpperCase();

  if (!normalized) {
    return { valid: false, code: normalized };
  }

  const entry = DISCOUNT_CODES[normalized];

  if (!entry) {
    return { valid: false, code: normalized };
  }

  // Check eligibility if user is provided and code has a restriction
  if (user && entry.eligible) {
    // Support both raw user doc and User instance (check .properties for User instance)
    const userDoc = user.properties || user;

    if (!entry.eligible(userDoc)) {
      return { valid: false, code: normalized, reason: 'not eligible' };
    }
  }

  // The result carries the ONE shape the code has — everything downstream reads a
  // validate() RESULT and never the table, so an amount code that reported no
  // amount would quietly charge full price everywhere. The absent shape is
  // OMITTED, never set to undefined: `POST /payments/intent` writes this object
  // into payments-intents/{orderId}, and firebase-admin refuses a document
  // carrying an undefined value — synchronously, after the processor has already
  // created the real checkout session
  // ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
  return {
    valid: true,
    code: normalized,
    ...(entry.percent !== undefined && { percent: entry.percent }),
    ...(entry.amount !== undefined && { amount: entry.amount }),
    duration: entry.duration,
  };
}

/**
 * Which shape a discount can be QUOTED as, or null for neither.
 *
 * A code in the table always declares exactly one shape, so a fresh validate()
 * result always answers 'percent' or 'amount' — the processors branch on that
 * directly. A discount read back off a STORED order is the case this exists for:
 * one written before the amount field existed is `valid` and carries no shape at
 * all, and a reader that assumed one would throw on it
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * @param {object} [discount] - A validate() result, a stored order's discount, or null
 * @returns {'percent'|'amount'|null}
 */
function promoShape(discount) {
  if (discount?.valid !== true) {
    return null;
  }

  if (discount.percent > 0) {
    return 'percent';
  }

  return discount.amount > 0 ? 'amount' : null;
}

/**
 * Apply a validated discount to a charge amount.
 *
 * The FIRST charge only — every code is `duration: 'once'`, so the renewal keeps
 * the full price and callers only ever hand this the amount being charged now.
 * Mirrors what a Stripe coupon does to the first invoice: `percent` is Stripe's
 * `percent_off`, `amount` its `amount_off` (in dollars here, not cents).
 *
 * @param {number} amount - The undiscounted charge (e.g., 99.99)
 * @param {object} [discount] - A validate() result, or null for no discount
 * @returns {number} The discounted charge, never below 0 (e.g., 84.99)
 */
function applyToAmount(amount, discount) {
  const base = Number(amount) || 0;

  if (!discount || discount.valid === false) {
    return base;
  }

  // `base * percent / 100`, in that order, is not a style choice: the callers this
  // function was folded out of all associated it that way, and `base * (percent /
  // 100)` differs by an ULP often enough to flip a half-cent rounding (a $0.05
  // charge at 10% off rounds to $0.05 one way and $0.04 the other)
  const off = discount.percent > 0
    ? base * discount.percent / 100
    : (discount.amount || 0);

  return Math.max(0, parseFloat((base - off).toFixed(2)));
}

module.exports = { validate, applyToAmount, promoShape, DISCOUNT_CODES };
