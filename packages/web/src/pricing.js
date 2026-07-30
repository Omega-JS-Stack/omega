/**
 * Pricing view-model composer — `payment.products` (omega.json5) is the ONLY
 * source for pricing pages (C2). The engine derives `site.pricing` from the
 * catalog and every theme renders that; consumer page frontmatter can still
 * override presentation per-page through the resolved cascade (frontmatter is
 * the consumer surface, never the framework's). No catalog → null → themes
 * render an honest empty state instead of fictional plans.
 *
 * Product presentation fields (optional, alongside the backend-shaped
 * id/name/type/limits/prices/trial):
 *   tagline    - short line under the plan name
 *   popular    - highlight badge on the plan card
 *   url        - CTA href (defaults to /signup for free plans; paid plans
 *                without a url get a checkout button instead)
 *   features   - display list [{ id, name, icon, definition, value }];
 *                value falls back to limits[id], -1 renders as Unlimited
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
 * Compose a product's display features, resolving values from limits.
 * @param {object} product - catalog entry
 * @returns {Array<object>} [{ id, name, icon, definition, value }]
 */
function composeFeatures(product) {
  const limits = product.limits || {};
  return (product.features || []).map((feature) => ({
    id: feature.id,
    name: feature.name,
    icon: feature.icon || null,
    definition: feature.definition || null,
    value: normalizeValue(feature.value !== undefined ? feature.value : limits[feature.id]),
  }));
}

/**
 * Compose one subscription plan card model.
 * @param {object} product - catalog entry (type subscription)
 * @returns {object} plan view-model
 */
function composePlan(product) {
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
      // What the card shows in "$N /month" while the annual toggle is active
      annuallyPerMonth: annually > 0 ? Math.round(annually / 12) : 0,
    },
    features: composeFeatures(product),
  };
}

/**
 * Backfill feature definitions by id: a definition authored on ANY product's
 * copy of a feature applies to every other copy — author the tooltip once in
 * omega.json5 and every instance (plan cards, extras, comparison) carries it.
 * @param {Array<Array<object>>} featureLists - composed feature arrays to unify
 */
function backfillDefinitions(featureLists) {
  const byId = new Map();
  for (const features of featureLists) {
    for (const feature of features) {
      if (feature.definition && !byId.has(feature.id)) byId.set(feature.id, feature.definition);
    }
  }
  for (const features of featureLists) {
    for (const feature of features) {
      if (!feature.definition) feature.definition = byId.get(feature.id) || null;
    }
  }
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
 * Compose the pricing view-model from the shared payment section.
 * @param {object} payment - resolved config `payment` section
 * @returns {object|null} { plans, oneTime, billing, savingsPercent, comparison } or null when the catalog is empty
 */
function composePricing(payment) {
  const products = payment && Array.isArray(payment.products) ? payment.products : [];
  if (products.length === 0) return null;

  const plans = products
    .filter((product) => (product.type || 'subscription') === 'subscription')
    .map(composePlan);

  const oneTime = products
    .filter((product) => product.type === 'one-time')
    .map((product) => ({
      id: product.id,
      name: product.name,
      tagline: product.tagline || null,
      price: (product.prices && typeof product.prices.once === 'number') ? product.prices.once : 0,
      features: composeFeatures(product),
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

  // Definitions unify BEFORE the comparison copies feature objects
  backfillDefinitions([
    ...plans.map((plan) => plan.features),
    ...oneTime.map((product) => product.features),
  ]);
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

  return {
    plans: plans,
    oneTime: oneTime,
    billing: billing,
    savingsPercent: savingsPercent,
    comparison: composeComparison(plans),
  };
}

module.exports = { composePricing };
