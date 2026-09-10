/**
 * Pricing view-model composer — `payment.products` (omega.json5) is the ONLY
 * source for pricing pages (C2). The engine derives `site.pricing` from the
 * catalog and every theme renders that; consumer page frontmatter can still
 * override presentation per-page through the resolved cascade (frontmatter is
 * the consumer surface, never the framework's). No catalog → null → themes
 * render an honest empty state instead of fictional plans.
 *
 * A feature is DEFINED once, in the config's top-level `features` catalog
 * (name, icon, definition, and a `usage` block on the metered ones), and each
 * product names only its VALUE
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)). So this
 * composer reads BOTH halves: the catalog decides row order and copy, the
 * product decides what its tier promises. There is nothing left to backfill —
 * a definition cannot disagree with itself when it exists in one place.
 *
 * Product presentation fields (optional, alongside the backend-shaped
 * id/name/type/prices/trial):
 *   tagline    - short line under the plan name
 *   popular    - highlight badge on the plan card
 *   enterprise - the "talk to us" tier: leaves BOTH card lanes (plans and
 *                one-time, whatever its type) and renders as its own
 *                full-width row (no enterprise product in the catalog → no
 *                row, never invented)
 *   url        - CTA href (defaults to /signup for free plans; /contact for
 *                the enterprise tier; paid plans without a url get a
 *                checkout button instead)
 *   features   - the values map { <catalog id>: value }: a number on a counted
 *                feature (-1 renders as Unlimited), true/a string on a perk,
 *                and `false` (or absent) means the tier does not include it
 *   hidden     - presentation-only exclusion (#348): the product is still
 *                created on every provider and purchasable by id (QA tiers,
 *                grandfathered plans), but the composer drops it before any
 *                lane reads the catalog — no card, no comparison row, no vote
 *                on the page's universal numbers
 */

const Logger = require('@omega.js/devkit/logger');

const logger = new Logger('pricing');

/**
 * Normalize a feature value for display: -1 is the catalog's "unlimited"
 * sentinel; undefined stays null so templates can render name-only features.
 * @param {*} value - raw feature/limit value
 * @returns {*} display value or null
 */
function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (value === -1) return 'Unlimited';
  return value;
}

/**
 * Compose a product's display features: the FEATURES CATALOG supplies the row
 * order, the name, the icon and the definition; the product supplies only the
 * value. A feature the product does not name — or names `false` — is not part
 * of that tier and renders nowhere.
 * @param {object} product - catalog entry (payment.products)
 * @param {object} catalog - the top-level `features` catalog
 * @returns {Array<object>} [{ id, name, icon, definition, value }]
 * @throws {Error} on the pre-#647 features LIST, naming the migration
 */
function composeFeatures(product, catalog) {
  const values = (product && product.features) || {};

  // The pre-#647 display LIST is a shape this composer stopped understanding
  // the day the catalog became the one home of a feature's copy — every key
  // lookup below misses, so an unmigrated brand would get cards with no
  // bullets and an empty comparison matrix. Say so instead (the config
  // validator refuses the same shape earlier; this is the backstop for the
  // readers that reach the composer without it).
  if (Array.isArray(values)) {
    throw new Error(
      `payment.products "${(product && product.id) || 'unnamed'}" carries the pre-#647 features LIST — `
      + 'write `features: { requests: 100, support: true }` and define each feature ONCE in the '
      + 'top-level `features` catalog (docs/shared/breaking-changes.md § Plan limits become the features catalog)',
    );
  }

  return Object.keys(catalog)
    .filter((id) => values[id] !== undefined && values[id] !== false)
    .map((id) => ({
      id: id,
      name: catalog[id].name || id,
      icon: catalog[id].icon || null,
      definition: catalog[id].definition || null,
      value: normalizeValue(values[id]),
    }));
}

/**
 * Compose one subscription plan card model.
 * @param {object} product - catalog entry (type subscription)
 * @returns {object} plan view-model
 */
function composePlan(product, catalog) {
  const prices = product.prices || {};
  const monthly = typeof prices.monthly === 'number' ? prices.monthly : 0;
  const annually = typeof prices.annually === 'number' ? prices.annually : 0;
  const free = monthly <= 0 && annually <= 0;

  return {
    id: product.id,
    name: product.name,
    tagline: product.tagline || null,
    popular: product.popular === true,
    free: free,
    url: product.url || (free ? '/signup' : null),
    trialDays: (product.trial && product.trial.days) || 0,
    prices: {
      monthly: monthly,
      annually: annually,
      // What the card shows in "$N /month" while the annual toggle is active.
      // FLOORS (#477 — legacy parity): the monthly equivalent never claims
      // more than a twelfth of what is actually charged.
      annuallyPerMonth: annually > 0 ? Math.floor(annually / 12) : 0,
    },
    features: composeFeatures(product, catalog),
  };
}

/**
 * Compose the enterprise tier: the "talk to us" product, priced by
 * conversation instead of by card — no prices, no billing cadence, a contact
 * CTA. It never enters the plan grid or the comparison matrix.
 * @param {object} product - catalog entry flagged `enterprise: true`
 * @returns {object} enterprise view-model
 */
function composeEnterprise(product, catalog) {
  return {
    id: product.id,
    name: product.name,
    tagline: product.tagline || null,
    url: product.url || '/contact',
    features: composeFeatures(product, catalog),
  };
}

/**
 * Split each plan's features into the set common to ALL plans (rendered with
 * per-plan values) and the plan's extras (rendered under "Everything in
 * <previous>, and more").
 * @param {Array<object>} plans - composed plans
 */
function splitCommonFeatures(plans) {
  const withFeatures = plans.filter((plan) => plan.features.length > 0);
  const commonIds = withFeatures.length === plans.length && plans.length > 0
    ? plans[0].features
      .filter((feature) => plans.every((plan) => plan.features.some((f) => f.id === feature.id)))
      .map((feature) => feature.id)
    : [];

  for (const plan of plans) {
    plan.commonFeatures = plan.features.filter((feature) => commonIds.includes(feature.id));
    plan.extraFeatures = plan.features.filter((feature) => !commonIds.includes(feature.id));
  }
}

/**
 * Build the feature-comparison matrix: the union of plan features in first-
 * appearance order, with per-plan values. A plan that doesn't declare a
 * feature inherits the value from the closest EARLIER plan that does (tiers
 * accumulate) — null means genuinely not included.
 * @param {Array<object>} plans - composed plans
 * @returns {{ features: Array<object> }}
 */
function composeComparison(plans) {
  const features = [];
  const byId = new Map();

  for (const plan of plans) {
    for (const feature of plan.features) {
      if (byId.has(feature.id)) continue;
      const entry = {
        id: feature.id,
        name: feature.name,
        icon: feature.icon,
        definition: feature.definition,
        values: {},
      };
      byId.set(feature.id, entry);
      features.push(entry);
    }
  }

  for (const entry of features) {
    let inherited = null;
    for (const plan of plans) {
      const own = plan.features.find((feature) => feature.id === entry.id);
      if (own) inherited = own.value !== null ? own.value : true;
      entry.values[plan.id] = own ? (own.value !== null ? own.value : true) : inherited;
    }
  }

  return { features: features };
}

/**
 * The catalog a page may show: `hidden: true` is presentation-only (#348), so
 * it drops here ONCE and every reader — the composer below, the `omega build`
 * empty-catalog warning — asks this one question.
 * @param {object} payment - resolved config `payment` section
 * @returns {Array<object>} the non-hidden products, in catalog order
 */
function visibleProducts(payment) {
  const catalog = payment && Array.isArray(payment.products) ? payment.products : [];
  return catalog.filter((product) => product.hidden !== true);
}

/**
 * Compose the pricing view-model from the shared payment section and the
 * features catalog.
 * @param {object} payment - resolved config `payment` section
 * @param {object} [features] - resolved config `features` catalog (#647)
 * @returns {object|null} { plans, oneTime, enterprise, billing, savingsPercent, comparison } or null when the catalog is empty
 */
function composePricing(payment, features) {
  // Every lane below composes from what the page may show (a catalog of
  // nothing else renders the empty state)
  const products = visibleProducts(payment);
  if (products.length === 0) return null;

  // The one home of what a feature IS. A brand with products but no catalog
  // renders cards with no bullets rather than inventing copy for them.
  const catalog = (features && typeof features === 'object' && !Array.isArray(features)) ? features : {};

  // The enterprise tier is a product like any other, marked `enterprise: true`
  // — it leaves the grid so the cards stay peers of each other
  const enterpriseProduct = products.find((product) => product.enterprise === true);
  const enterprise = enterpriseProduct ? composeEnterprise(enterpriseProduct, catalog) : null;

  const plans = products
    .filter((product) => (product.type || 'subscription') === 'subscription' && product.enterprise !== true)
    .map((product) => composePlan(product, catalog));

  const oneTime = products
    .filter((product) => product.type === 'one-time' && product.enterprise !== true)
    .map((product) => ({
      id: product.id,
      name: product.name,
      tagline: product.tagline || null,
      price: (product.prices && typeof product.prices.once === 'number') ? product.prices.once : 0,
      features: composeFeatures(product, catalog),
    }));

  // The comparison inherits feature values by catalog position (tiers
  // accumulate), so `payment.products` must be authored lowest tier first —
  // warn when prices are non-monotonic instead of silently composing a
  // wrong matrix.
  for (let i = 1; i < plans.length; i++) {
    const prev = plans[i - 1].prices;
    const curr = plans[i].prices;
    const prevRank = prev.monthly || prev.annually;
    const currRank = curr.monthly || curr.annually;
    if (currRank < prevRank) {
      logger.warn(`payment.products lists "${plans[i].id}" after the pricier "${plans[i - 1].id}" — the comparison matrix inherits values by catalog order (lowest tier first); reorder the catalog.`);
    }
  }

  splitCommonFeatures(plans);

  // Billing toggle only exists when both cadences are actually purchasable
  const billing = {
    monthly: plans.some((plan) => plan.prices.monthly > 0),
    annually: plans.some((plan) => plan.prices.annually > 0),
  };

  // Honest annual-savings badge: the best real discount across paid plans
  let savingsPercent = 0;
  for (const plan of plans) {
    if (plan.prices.monthly > 0 && plan.prices.annually > 0) {
      const percent = Math.round((1 - plan.prices.annually / (plan.prices.monthly * 12)) * 100);
      if (percent > savingsPercent) savingsPercent = percent;
    }
  }

  // The catalog's trial, as ONE number the page can speak (#273). The copy it
  // feeds is UNIVERSAL ("every paid plan starts with a N-day free trial"), so
  // the number only exists when every paid plan agrees on it: a catalog whose
  // paid plans carry different trials (or one without a trial at all) speaks
  // no universal number → 0, and trial copy renders nowhere, exactly like a
  // catalog with no trial. Free plans carry nothing to disagree with, and the
  // per-plan `plan.trialDays` still states each plan's own truth.
  const paidPlans = plans.filter((plan) => !plan.free);
  const trialDays = paidPlans.length > 0 && paidPlans.every((plan) => plan.trialDays === paidPlans[0].trialDays)
    ? paidPlans[0].trialDays
    : 0;

  return {
    plans: plans,
    oneTime: oneTime,
    enterprise: enterprise,
    billing: billing,
    savingsPercent: savingsPercent,
    trialDays: trialDays,
    comparison: composeComparison(plans),
  };
}

module.exports = { composePricing, visibleProducts };
