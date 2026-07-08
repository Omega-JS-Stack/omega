/**
 * Ensure Chargebee items and item prices exist for all paid products.
 *
 * Uses the Items model (Item Family → Item → Item Price) with fully
 * deterministic IDs — family = {brandId}, item = {brandId}-{productId},
 * price = {brandId}-{productId}-{interval} — so resolution needs no stored
 * state at all: a 404 on the deterministic ID means "create it". Items are
 * diffed on name/external_name/description/redirect_url/metadata; prices on
 * amount (updated in place — Chargebee allows it) plus trial/external_name.
 * Legacy plans (product.chargebee.legacyPlanIds, the pre-Items model) are
 * reported read-only. One-time 'once' prices aren't managed yet (visible
 * note; omega-manager skipped them silently).
 */
const chalk = require('chalk').default;
const { paidProducts, productDisplayName } = require('../lib/payment-utils.js');

// Map config interval names to Chargebee period units
// (Chargebee does not support daily billing cycles)
const INTERVAL_MAP = {
  annually: { period_unit: 'year', period: 1 },
  monthly: { period_unit: 'month', period: 1 },
  weekly: { period_unit: 'week', period: 1 },
};

// Map product types to Chargebee item types
const TYPE_MAP = {
  subscription: 'plan',
  'one-time': 'charge',
};

/**
 * Whether an API error means "resource doesn't exist"
 */
function isNotFound(error) {
  return error.message.includes('404')
    || error.message.includes('not_found')
    || error.message.includes('resource_not_found');
}

/**
 * Build desired item details from brand/product config
 */
function buildItemDetails(brandConfig, brandId, product) {
  return {
    name: productDisplayName(brandConfig, product),
    externalName: product.name,
    description: product.description || brandConfig.brand.description || '',
    redirectUrl: brandConfig.brand.url,
    metadata: { brandId, productId: product.id },
  };
}

/**
 * Diff a Chargebee item against desired and return the update payload
 */
function getItemUpdates(chargebeeItem, desired) {
  const updates = {};

  if (chargebeeItem.name !== desired.name) {
    updates.name = desired.name;
  }
  if ((chargebeeItem.external_name || '') !== desired.externalName) {
    updates.external_name = desired.externalName;
  }
  if ((chargebeeItem.description || '') !== desired.description) {
    updates.description = desired.description;
  }
  if ((chargebeeItem.redirect_url || '') !== desired.redirectUrl) {
    updates.redirect_url = desired.redirectUrl;
  }

  const existingMeta = parseMetadata(chargebeeItem.metadata);
  if (existingMeta.brandId !== desired.metadata.brandId || existingMeta.productId !== desired.metadata.productId) {
    updates.metadata = JSON.stringify(desired.metadata);
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * Parse Chargebee metadata (may be a JSON string or object)
 */
function parseMetadata(metadata) {
  if (!metadata) {
    return {};
  }
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata;
}

/**
 * Ensure the Item Family for this brand exists (family ID = brandId)
 */
async function ensureItemFamily(api, familyId, brandConfig, dryRun) {
  let family;
  try {
    family = await api.getItemFamily(familyId);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    if (dryRun) {
      console.log(`      ${chalk.cyan('+')} Would create Item Family: ${chalk.dim(familyId)} "${brandConfig.brand.name}" ${chalk.yellow('[DRY RUN]')}`);
      return;
    }

    family = await api.createItemFamily({
      id: familyId,
      name: brandConfig.brand.name,
      description: brandConfig.brand.description || '',
    });
    console.log(`      ${chalk.green('✓')} Created Item Family: ${chalk.cyan(family.id)}`);
    return;
  }

  console.log(`      ${chalk.green('✓')} Item Family: ${chalk.dim(family.id)}`);

  if (family.name !== brandConfig.brand.name) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('~')} Would update family name: "${family.name}" → "${brandConfig.brand.name}" ${chalk.yellow('[DRY RUN]')}`);
    } else {
      await api.updateItemFamily(familyId, { name: brandConfig.brand.name });
      console.log(`      ${chalk.green('✓')} Updated family name: ${brandConfig.brand.name}`);
    }
  }
}

/**
 * Ensure item prices on a Chargebee item match config amounts.
 * Deterministic price IDs: {brandId}-{productId}-{interval}
 */
async function ensureItemPrices(api, itemId, product, brandConfig, brandId, dryRun) {
  const existingPrices = await api.listItemPricesForItem(itemId);
  const trialDays = product.trial?.days || 0;

  for (const interval of Object.keys(product.prices)) {
    const expectedAmount = product.prices[interval];

    if (!expectedAmount) {
      continue;
    }

    const mapping = INTERVAL_MAP[interval];

    // One-time 'once' prices aren't managed yet (charge-type items exist
    // without prices; checkout uses ad-hoc charges)
    if (!mapping && interval === 'once') {
      console.log(`        ${chalk.dim('⊘ once: one-time charge prices not managed yet')}`);
      continue;
    }

    if (!mapping) {
      throw new Error(`Chargebee does not support "${interval}" billing cycle. Use weekly, monthly, or annually instead.`);
    }

    const expectedCents = Math.round(expectedAmount * 100);
    const priceId = `${brandId}-${product.id}-${interval}`;
    const priceName = `${productDisplayName(brandConfig, product)} (${interval.charAt(0).toUpperCase() + interval.slice(1)})`;

    const existing = existingPrices.find((p) => p.id === priceId);

    if (existing) {
      if (existing.price === expectedCents) {
        const statusIcon = existing.status === 'active' ? chalk.green('✓') : chalk.yellow('⚠');
        console.log(`        ${statusIcon} ${interval}: $${expectedAmount} ${chalk.dim(priceId)}`);

        // Minor fields (trial, external_name) may still need updating
        const priceUpdates = {};

        if (trialDays > 0 && existing.trial_period !== trialDays) {
          priceUpdates.trial_period = trialDays;
          priceUpdates.trial_period_unit = 'day';
        }

        if ((existing.external_name || '') !== priceName) {
          priceUpdates.external_name = priceName;
        }

        if (Object.keys(priceUpdates).length > 0) {
          const fields = Object.keys(priceUpdates).join(', ');
          if (dryRun) {
            console.log(`          ${chalk.cyan('~')} Would update: ${fields} ${chalk.yellow('[DRY RUN]')}`);
          } else {
            await api.updateItemPrice(priceId, priceUpdates);
            console.log(`          ${chalk.green('✓')} Updated: ${fields}`);
          }
        }

        continue;
      }

      // Price amount changed — update in place
      if (dryRun) {
        console.log(`        ${chalk.cyan('~')} ${interval}: would update $${existing.price / 100} → $${expectedAmount} ${chalk.dim(priceId)} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        await api.updateItemPrice(priceId, { price: expectedCents });
        console.log(`        ${chalk.green('✓')} ${interval}: updated $${existing.price / 100} → $${expectedAmount} ${chalk.dim(priceId)}`);
      }
      continue;
    }

    // Item price doesn't exist — create it
    if (dryRun) {
      const trialLabel = trialDays > 0 ? ` (${trialDays}d trial)` : '';
      console.log(`        ${chalk.cyan('+')} ${interval}: would create $${expectedAmount}${trialLabel} "${priceName}" ${chalk.yellow('[DRY RUN]')}`);
      continue;
    }

    const createParams = {
      id: priceId,
      itemId,
      name: priceName,
      externalName: priceName,
      pricingModel: 'flat_fee',
      price: expectedCents,
      currencyCode: 'USD',
      periodUnit: mapping.period_unit,
      period: mapping.period,
    };

    if (trialDays > 0) {
      createParams.trialPeriod = trialDays;
      createParams.trialPeriodUnit = 'day';
    }

    const newPrice = await api.createItemPrice(createParams);
    console.log(`        ${chalk.green('✓')} ${interval}: created $${expectedAmount} ${chalk.cyan(newPrice.id)}`);
  }
}

/**
 * Report legacy Chargebee plans (the pre-Items model) read-only — the
 * backend needs to know they still resolve; nothing modifies them.
 */
async function logLegacyPlans(api, products) {
  const legacyIds = new Map(); // planId → productId
  for (const product of products) {
    for (const id of product.chargebee?.legacyPlanIds || []) {
      legacyIds.set(id, product.id);
    }
  }

  if (legacyIds.size === 0) {
    return;
  }

  console.log(`      ${chalk.dim('Legacy Chargebee plans:')}`);

  for (const [legacyPlanId, productId] of legacyIds) {
    try {
      const plan = await api.getPlan(legacyPlanId);
      const statusColor = plan.status === 'active' ? chalk.green : chalk.yellow;
      const price = plan.price ? `$${plan.price / 100}` : 'N/A';
      const period = plan.period_unit ? `/${plan.period}${plan.period_unit}` : '';

      console.log(`        ${chalk.green('✓')} ${chalk.dim(legacyPlanId)} → ${productId}: ${statusColor(plan.status)} ${price}${period} "${plan.name || ''}"`);
    } catch (error) {
      if (isNotFound(error)) {
        console.log(`        ${chalk.yellow('⚠')} ${chalk.dim(legacyPlanId)} → ${productId}: ${chalk.red('not found')}`);
      } else {
        console.log(`        ${chalk.yellow('⚠')} ${chalk.dim(legacyPlanId)} → ${productId}: ${chalk.dim(error.message)}`);
      }
    }
  }
}

module.exports = async function ensureChargebeeProducts(context) {
  const { brandConfig, brandId, chargebeeApi: api, options } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Chargebee not configured')}`);
    return {};
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} No changes will be made`);
  }

  const products = paidProducts(brandConfig);

  // --- Step 1: Ensure the brand's Item Family exists ---
  const familyId = brandId;
  await ensureItemFamily(api, familyId, brandConfig, dryRun);

  // --- Step 2: Ensure Items + Item Prices ---
  for (const product of products) {
    console.log(`      ${chalk.bold(product.name)} (${product.id}):`);

    const desired = buildItemDetails(brandConfig, brandId, product);
    const itemId = `${brandId}-${product.id}`;
    const itemType = TYPE_MAP[product.type] || 'plan';

    let chargebeeItem;
    try {
      chargebeeItem = await api.getItem(itemId);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }

      // Item doesn't exist — create it
      if (dryRun) {
        console.log(`        ${chalk.cyan('+')} Would create item: ${chalk.dim(desired.name)} (${itemType}) ${chalk.yellow('[DRY RUN]')}`);
        for (const [interval, amount] of Object.entries(product.prices)) {
          if (!amount) {
            continue;
          }
          const trialDays = product.trial?.days || 0;
          const trialLabel = trialDays > 0 ? ` (${trialDays}d trial)` : '';
          console.log(`          ${chalk.cyan('+')} ${interval}: $${amount}${trialLabel} ${chalk.dim(`${itemId}-${interval}`)} ${chalk.yellow('[DRY RUN]')}`);
        }
        continue;
      }

      chargebeeItem = await api.createItem({
        id: itemId,
        name: desired.name,
        externalName: desired.externalName,
        type: itemType,
        itemFamilyId: familyId,
        description: desired.description,
        redirectUrl: desired.redirectUrl,
        metadata: desired.metadata,
      });
      console.log(`        ${chalk.green('✓')} Created item: ${chalk.cyan(chargebeeItem.id)}`);

      await ensureItemPrices(api, itemId, product, brandConfig, brandId, dryRun);
      continue;
    }

    console.log(`        ${chalk.green('✓')} Item exists: ${chalk.dim(chargebeeItem.id)}`);

    const updates = getItemUpdates(chargebeeItem, desired);
    if (updates) {
      const fields = Object.keys(updates).join(', ');
      if (dryRun) {
        console.log(`        ${chalk.cyan('~')} Would update: ${chalk.dim(fields)} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        await api.updateItem(itemId, updates);
        console.log(`        ${chalk.green('✓')} Updated: ${chalk.dim(fields)}`);
      }
    }

    await ensureItemPrices(api, itemId, product, brandConfig, brandId, dryRun);
  }

  // --- Step 3: Report legacy plans ---
  await logLegacyPlans(api, products);

  return { output: { chargebeeSync: { productsProcessed: products.length } } };
};
