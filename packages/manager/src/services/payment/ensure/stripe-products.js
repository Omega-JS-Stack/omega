/**
 * Ensure Stripe products and prices exist for all paid products.
 *
 * Product resolution: config productId → state (stripeProducts map) →
 * metadata match against the account's products (self-heal when state is
 * lost — every product we create carries { brandId, productId } metadata) →
 * create. Created/matched IDs land in state until the config-serializer
 * port can write them back to omega.json5. Prices are managed by
 * interval + amount — matching active prices are kept, stale ones archived
 * (Stripe can't delete prices), missing ones created. omega-manager's
 * version had no dry-run guard and no archived-product skip here; both are
 * standard now.
 */
const chalk = require('chalk').default;
const { paidProducts, productDisplayName, productImage } = require('../lib/payment-utils.js');

// Map config interval names to Stripe price intervals
const FREQUENCY_TO_INTERVAL = {
  annually: 'year',
  monthly: 'month',
  weekly: 'week',
  daily: 'day',
};

/**
 * Build desired product details from brand/product config.
 * Images are only managed when brand.images.brandmark is configured.
 */
function buildProductDetails(brandConfig, brandId, product) {
  return {
    name: productDisplayName(brandConfig, product),
    description: product.description || brandConfig.brand.description || '',
    images: productImage(brandConfig) ? [productImage(brandConfig)] : null,
    url: brandConfig.brand.url,
    metadata: { brandId, productId: product.id },
  };
}

/**
 * Diff a Stripe product against desired and return the update payload
 */
function getProductUpdates(stripeProduct, desired) {
  const updates = {};

  if (stripeProduct.name !== desired.name) {
    updates.name = desired.name;
  }
  if ((stripeProduct.description || '') !== desired.description) {
    updates.description = desired.description;
  }
  if (stripeProduct.url !== desired.url) {
    updates.url = desired.url;
  }

  if (desired.images && JSON.stringify(stripeProduct.images || []) !== JSON.stringify(desired.images)) {
    updates.images = desired.images;
  }

  // Metadata — ensure all desired keys exist with correct values
  const currentMeta = stripeProduct.metadata || {};
  const metadataUpdates = {};
  for (const [key, value] of Object.entries(desired.metadata)) {
    if (currentMeta[key] !== value) {
      metadataUpdates[key] = value;
    }
  }
  if (Object.keys(metadataUpdates).length > 0) {
    updates.metadata = { ...currentMeta, ...metadataUpdates };
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * Ensure active prices on a Stripe product match config amounts.
 * Creates missing prices, archives actives at the wrong amount.
 */
async function ensurePrices(api, stripeProductId, product, dryRun) {
  const activePrices = await api.listPricesForProduct(stripeProductId);

  if (product.type === 'subscription') {
    for (const interval of Object.keys(product.prices)) {
      const expectedAmount = product.prices[interval];

      if (!expectedAmount) {
        continue;
      }

      const expectedCents = Math.round(expectedAmount * 100);
      const stripeInterval = FREQUENCY_TO_INTERVAL[interval] || 'month';

      const match = activePrices.find((p) =>
        p.active
        && p.recurring?.interval === stripeInterval
        && p.unit_amount === expectedCents
      );

      if (match) {
        console.log(`        ${chalk.green('✓')} ${interval}: $${expectedAmount} ${chalk.dim(match.id)}`);
        continue;
      }

      // Archive active prices at the wrong amount for this interval
      const stale = activePrices.filter((p) =>
        p.active
        && p.recurring?.interval === stripeInterval
      );

      for (const old of stale) {
        if (dryRun) {
          console.log(`        ${chalk.yellow('↓')} ${interval}: would archive $${old.unit_amount / 100} ${chalk.dim(old.id)} ${chalk.yellow('[DRY RUN]')}`);
        } else {
          await api.archivePrice(old.id);
          console.log(`        ${chalk.yellow('↓')} ${interval}: archived $${old.unit_amount / 100} ${chalk.dim(old.id)}`);
        }
      }

      if (dryRun) {
        console.log(`        ${chalk.cyan('+')} ${interval}: would create $${expectedAmount} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        const newPrice = await api.createRecurringPrice(stripeProductId, expectedAmount, interval);
        console.log(`        ${chalk.green('✓')} ${interval}: created $${expectedAmount} ${chalk.cyan(newPrice.id)}`);
      }
    }
  }

  if (product.type === 'one-time') {
    const expectedAmount = product.prices.once;

    if (expectedAmount) {
      const expectedCents = Math.round(expectedAmount * 100);
      const match = activePrices.find((p) => p.active && !p.recurring && p.unit_amount === expectedCents);

      if (match) {
        console.log(`        ${chalk.green('✓')} once: $${expectedAmount} ${chalk.dim(match.id)}`);
      } else {
        const stale = activePrices.filter((p) => p.active && !p.recurring);
        for (const old of stale) {
          if (dryRun) {
            console.log(`        ${chalk.yellow('↓')} once: would archive $${old.unit_amount / 100} ${chalk.dim(old.id)} ${chalk.yellow('[DRY RUN]')}`);
          } else {
            await api.archivePrice(old.id);
            console.log(`        ${chalk.yellow('↓')} once: archived $${old.unit_amount / 100} ${chalk.dim(old.id)}`);
          }
        }

        if (dryRun) {
          console.log(`        ${chalk.cyan('+')} once: would create $${expectedAmount} ${chalk.yellow('[DRY RUN]')}`);
        } else {
          const newPrice = await api.createOneTimePrice(stripeProductId, expectedAmount);
          console.log(`        ${chalk.green('✓')} once: created $${expectedAmount} ${chalk.cyan(newPrice.id)}`);
        }
      }
    }
  }
}

module.exports = async function ensureStripeProducts(context) {
  const { brandConfig, brandId, stripeApi: api, options, serviceData } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Stripe not configured')}`);
    return {};
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} No changes will be made`);
  }

  const products = paidProducts(brandConfig);
  const knownIds = { ...(serviceData.stripeProducts || {}) };
  let stateChanged = false;
  let catalog = null; // Lazy-listed only when a product has no known ID

  for (const product of products) {
    console.log(`      ${chalk.bold(product.name)} (${product.id}):`);

    const desired = buildProductDetails(brandConfig, brandId, product);

    // --- Resolve the Stripe product: config → state → metadata match → create ---
    let stripeId = product.stripe?.productId || knownIds[product.id] || null;
    let stripeProduct = null;

    if (stripeId) {
      stripeProduct = await api.getProduct(stripeId);
    } else {
      // Self-heal: our products carry { brandId, productId } metadata
      catalog = catalog || await api.listAllProducts();
      stripeProduct = catalog.find((p) =>
        p.active !== false
        && p.metadata?.brandId === brandId
        && p.metadata?.productId === product.id
      ) || null;

      if (stripeProduct) {
        knownIds[product.id] = stripeProduct.id;
        stateChanged = true;
        console.log(`        ${chalk.green('✓')} Matched existing product by metadata: ${chalk.dim(stripeProduct.id)}`);
      }
    }

    if (stripeProduct) {
      console.log(`        ${chalk.green('✓')} Product exists: ${chalk.dim(stripeProduct.id)}`);

      const updates = getProductUpdates(stripeProduct, desired);
      if (updates) {
        const fields = Object.keys(updates).join(', ');
        if (dryRun) {
          console.log(`        ${chalk.cyan('~')} Would update: ${chalk.dim(fields)} ${chalk.yellow('[DRY RUN]')}`);
        } else {
          await api.updateProduct(stripeProduct.id, updates);
          console.log(`        ${chalk.green('✓')} Updated: ${chalk.dim(fields)}`);
        }
      }
    } else {
      if (dryRun) {
        console.log(`        ${chalk.cyan('+')} Would create product: ${chalk.dim(desired.name)} ${chalk.yellow('[DRY RUN]')}`);
        // Can't manage prices without a real product ID
        continue;
      }

      stripeProduct = await api.createProduct({
        name: desired.name,
        brandId,
        productId: product.id,
        description: desired.description,
        images: desired.images || undefined,
        url: desired.url,
      });
      console.log(`        ${chalk.green('✓')} Created product: ${chalk.cyan(stripeProduct.id)}`);

      knownIds[product.id] = stripeProduct.id;
      stateChanged = true;
    }

    // --- Ensure prices match config amounts ---
    await ensurePrices(api, stripeProduct.id, product, dryRun);
  }

  const result = { output: { stripeSync: { productsProcessed: products.length } } };
  if (stateChanged && !dryRun) {
    result.state = { stripeProducts: knownIds };
  }
  return result;
};
