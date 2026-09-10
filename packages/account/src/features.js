/**
 * features.js — the ONE reading of the features contract
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * A feature is DEFINED once, in the config's top-level `features` catalog:
 *
 *   features: {
 *     saves:   { name: 'Saves', icon: 'feather', definition: '…',
 *                usage: { pace: 'daily', mirror: ['teams'] } },
 *     support: { name: 'Priority support', icon: 'headset' },
 *   }
 *
 * A `usage` block makes the entry COUNTED (metered per user); an entry without
 * one is a PERK, never counted. Each product then names only its VALUE:
 * `features: { saves: 100, support: true }` — a number on a counted feature
 * (the MONTHLY limit, -1 unlimited), true/false/a string on a perk.
 *
 * This module is the shared home of every derivation both sides make from
 * those two halves plus a user's stored counters — the backend's `consume`
 * gate and the browser's account page must never disagree about what a user's
 * limit is:
 *   - the EFFECTIVE limit, where an admin-written `usage.overrides.<feature>`
 *     on the user doc wins over the plan's number;
 *   - the DAY share, `ceil(limit / days in this month)`, so a monthly quota
 *     cannot be burned on day one (pacing is the default; `pace: false` opts
 *     out to a plain monthly counter);
 *   - the two counters a counted feature carries per user, month and day.
 *
 * -1 is the unlimited sentinel everywhere it can appear: a limit, a day share,
 * and a remaining count.
 */

// Where a user's counters and overrides live on the account document.
const USAGE_KEY = 'usage';
const OVERRIDES_KEY = 'overrides';

/**
 * Is this catalog entry COUNTED? A `usage` block is what meters a feature;
 * everything else is a perk the plan either includes or does not.
 * @param {object} entry - a top-level `features` catalog entry
 * @returns {boolean}
 */
function isCountedFeature(entry) {
  return !!(entry && typeof entry === 'object' && entry.usage && typeof entry.usage === 'object' && !Array.isArray(entry.usage));
}

/**
 * Is this feature paced by day? Pacing is the DEFAULT on every counted
 * feature; `usage: { pace: false }` opts out to a plain monthly counter.
 * @param {object} entry - a catalog entry
 * @returns {boolean}
 */
function isPacedFeature(entry) {
  return isCountedFeature(entry) && entry.usage.pace !== false;
}

/**
 * The document kinds a counted feature's counters mirror onto, declared in the
 * catalog rather than at the call site.
 * @param {object} entry - a catalog entry
 * @returns {string[]} the declared kinds, or []
 */
function featureMirrors(entry) {
  return isCountedFeature(entry) && Array.isArray(entry.usage.mirror) ? entry.usage.mirror : [];
}

/**
 * Days in the month the given date falls in.
 * @param {Date} [date] - defaults to now
 * @returns {number}
 */
function daysInMonth(date) {
  const d = date || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * A month limit's share of ONE day: ceil(limit / days in this month), so a
 * quota of 100 in a 31-day month allows 4 a day and never 100 on the 1st.
 * Unlimited stays unlimited; nothing stays nothing.
 * @param {number} limit - the effective MONTHLY limit (-1 unlimited)
 * @param {Date} [date] - the day being paced, defaults to now
 * @returns {number} the day's share (-1 unlimited)
 */
function dayShare(limit, date) {
  if (!Number.isFinite(limit) || limit === 0) return 0;
  if (limit < 0) return -1;
  return Math.ceil(limit / daysInMonth(date));
}

/**
 * The per-user override for a feature, when the account carries one. Written
 * by admins only (the user doc's `usage` key is a framework field the security
 * rules deny a client), and it WINS over the plan's number — extra credits
 * granted to one account, not a second pricing tier.
 * @param {object} account - the user document
 * @param {string} id - feature id
 * @returns {number|null} the override, or null when there is none
 */
function featureOverride(account, id) {
  const value = account && account[USAGE_KEY] && account[USAGE_KEY][OVERRIDES_KEY]
    ? account[USAGE_KEY][OVERRIDES_KEY][id]
    : undefined;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a product promises for one feature: its raw value from the product's
 * `features` map. A product that never names the feature promises nothing.
 * @param {object} product - a `payment.products` entry
 * @param {string} id - feature id
 * @returns {*} the value, or undefined
 */
function productFeatureValue(product, id) {
  const values = product && product.features;
  return values && typeof values === 'object' && !Array.isArray(values) ? values[id] : undefined;
}

/**
 * The counters a user carries for one feature. The stored shape is
 * `usage.<id>.{ monthly, daily, total, last }` — monthly and daily are the two
 * the gate reads, total never resets, last records when it moved.
 * @param {object} account - the user document
 * @param {string} id - feature id
 * @returns {{ monthly: number, daily: number, total: number }}
 */
function featureCounters(account, id) {
  const stored = (account && account[USAGE_KEY] && account[USAGE_KEY][id]) || {};
  const read = (key) => (typeof stored[key] === 'number' && Number.isFinite(stored[key]) ? stored[key] : 0);

  return { monthly: read('monthly'), daily: read('daily'), total: read('total') };
}

/**
 * How many of a limit are left, given what is used. Unlimited stays unlimited.
 * @param {number} limit - the limit (-1 unlimited)
 * @param {number} used - the counter
 * @returns {number} what remains (-1 unlimited), never below zero
 */
function remaining(limit, used) {
  if (limit < 0) return -1;
  return Math.max(0, limit - used);
}

/**
 * Resolve ONE feature against a catalog, a product and an account: everything
 * a gate or an account page needs to speak about it in one object.
 *
 * @param {string} id - feature id
 * @param {object} options
 * @param {object} [options.catalog] - the top-level `features` catalog
 * @param {object} [options.product] - the account's resolved product
 * @param {object} [options.account] - the user document (counters + overrides)
 * @param {Date} [options.now] - the day being paced, defaults to now
 * @returns {object} { id, name, icon, definition, counted, paced, mirror,
 *   value, limit, planLimit, override, used, left, total,
 *   day: { limit, used, left } }
 */
function resolveFeature(id, options) {
  options = options || {};

  const entry = (options.catalog || {})[id] || null;
  const counted = isCountedFeature(entry);
  const value = productFeatureValue(options.product, id);
  const counters = featureCounters(options.account, id);
  const override = featureOverride(options.account, id);

  const planLimit = counted && typeof value === 'number' ? value : 0;
  const limit = counted && override !== null ? override : planLimit;
  const paced = isPacedFeature(entry);
  const dayLimit = paced ? dayShare(limit, options.now) : -1;

  return {
    id: id,
    name: (entry && entry.name) || id,
    icon: (entry && entry.icon) || null,
    definition: (entry && entry.definition) || null,
    counted: counted,
    paced: paced,
    mirror: featureMirrors(entry),
    value: counted ? limit : value,
    limit: limit,
    planLimit: planLimit,
    override: override,
    used: counters.monthly,
    left: remaining(limit, counters.monthly),
    total: counters.total,
    day: {
      limit: dayLimit,
      used: counters.daily,
      left: remaining(dayLimit, counters.daily),
    },
  };
}

/**
 * Resolve every feature the catalog defines, in CATALOG order — the row order
 * every surface renders (pricing rows, account bars).
 * @param {object} options - same options as resolveFeature
 * @returns {object[]} one resolved feature per catalog entry
 */
function resolveFeatures(options) {
  options = options || {};

  return Object.keys(options.catalog || {}).map((id) => resolveFeature(id, options));
}

module.exports = {
  isCountedFeature,
  isPacedFeature,
  featureMirrors,
  featureOverride,
  featureCounters,
  productFeatureValue,
  daysInMonth,
  dayShare,
  resolveFeature,
  resolveFeatures,
};
