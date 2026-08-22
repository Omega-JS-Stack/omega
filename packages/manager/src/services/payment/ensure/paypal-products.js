/**
 * Ensure PayPal catalog products and billing plans exist for all paid
 * products.
 *
 * Product resolution: config productId → state (paypalProducts map) →
 * exact-name match against the catalog (self-heal when state is lost) →
 * create. Created/matched IDs are written back into omega.json5
 * (payment.products[id=…].paypal.productId — comment-preserving) and
 * mirrored in state. Plans are managed by interval + amount + trial —
 * matching active plans are kept, duplicates and stale plans deactivated,
 * missing ones created. Legacy products (product.paypal.legacyProductIds)
 * get their active plans deactivated so no new subscriptions land on them.
 *
 * In sandbox mode the ensured products are the payments-QA fixtures, so the
 * step closes with the sandbox-buyer reminder (see below).
 */
const chalk = require('chalk').default;
const { paidProducts, productDisplayName, productImage } = require('../lib/payment-utils.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');

// Map config interval names to PayPal interval units
const FREQUENCY_TO_INTERVAL = {
  annually: 'YEAR',
  monthly: 'MONTH',
  weekly: 'WEEK',
  daily: 'DAY',
};

// PayPal Developer Dashboard → Sandbox → Accounts (the only surface that mints
// a sandbox buyer) and the drive runbook that documents the hoops
const SANDBOX_ACCOUNTS_URL = 'https://developer.paypal.com/dashboard/accounts';
const SANDBOX_QA_RUNBOOK = '@omega.js/backend/docs/paypal-sandbox-qa.md';

/**
 * Build desired catalog-product details from brand/product config
 */
function buildProductDetails(brandConfig, product) {
  return {
    name: productDisplayName(brandConfig, product),
    description: (product.description || brandConfig.brand.description || '').slice(0, 256),
    imageUrl: productImage(brandConfig),
    homeUrl: brandConfig.brand.url,
  };
}

/**
 * Diff a PayPal catalog product against desired and return JSON Patch ops.
 * Images are only managed when brand.images.brandmark is configured.
 */
function getProductUpdates(paypalProduct, desired) {
  const patches = [];

  if (paypalProduct.name !== desired.name) {
    patches.push({ op: 'replace', path: '/name', value: desired.name });
  }
  if ((paypalProduct.description || '') !== desired.description) {
    patches.push({ op: 'replace', path: '/description', value: desired.description });
  }
  if (desired.imageUrl && paypalProduct.image_url !== desired.imageUrl) {
    patches.push({ op: 'replace', path: '/image_url', value: desired.imageUrl });
  }
  if (paypalProduct.home_url !== desired.homeUrl) {
    patches.push({ op: 'replace', path: '/home_url', value: desired.homeUrl });
  }

  return patches.length > 0 ? patches : null;
}

/**
 * Check if a plan's billing cycles match the expected config.
 * Matches on: interval unit, amount, and trial days.
 */
function isPlanMatch(plan, intervalUnit, expectedAmount, trialDays) {
  if (plan.status !== 'ACTIVE') {
    return false;
  }

  const regularCycle = plan.billing_cycles?.find((c) => c.tenure_type === 'REGULAR');
  if (!regularCycle) {
    return false;
  }

  if (regularCycle.frequency?.interval_unit !== intervalUnit) {
    return false;
  }

  const planAmount = parseFloat(regularCycle.pricing_scheme?.fixed_price?.value || '0');
  if (planAmount !== expectedAmount) {
    return false;
  }

  const trialCycle = plan.billing_cycles?.find((c) => c.tenure_type === 'TRIAL');
  if (trialDays > 0) {
    if (!trialCycle || trialCycle.total_cycles !== trialDays) {
      return false;
    }
  } else if (trialCycle) {
    return false;
  }

  return true;
}

/**
 * Ensure billing plans on a PayPal product match config.
 * Creates new plans if missing, deactivates duplicates and stale plans.
 */
async function ensurePlans(api, paypalProductId, product, brandConfig, dryRun) {
  const plans = await api.listPlansForProduct(paypalProductId);
  const trialDays = product.trial?.days || 0;

  for (const interval of Object.keys(product.prices)) {
    const expectedAmount = product.prices[interval];

    if (!expectedAmount) {
      continue;
    }

    const intervalUnit = FREQUENCY_TO_INTERVAL[interval];

    // Skip 'once' — one-time products don't have plans
    if (!intervalUnit) {
      continue;
    }

    // Split this interval's active plans into matches and stale
    const matches = [];
    const stale = [];

    for (const plan of plans) {
      if (plan.status !== 'ACTIVE') {
        continue;
      }
      const regularCycle = plan.billing_cycles?.find((c) => c.tenure_type === 'REGULAR');
      if (regularCycle?.frequency?.interval_unit !== intervalUnit) {
        continue;
      }

      if (isPlanMatch(plan, intervalUnit, expectedAmount, trialDays)) {
        matches.push(plan);
      } else {
        stale.push(plan);
      }
    }

    // Keep the first match, deactivate duplicates + stale
    const match = matches[0] || null;
    const duplicates = matches.slice(1);

    if (match) {
      console.log(`        ${chalk.green('✓')} ${interval}: $${expectedAmount} ${chalk.dim(match.id)}`);
    }

    for (const dup of duplicates) {
      if (dryRun) {
        console.log(`        ${chalk.yellow('↓')} ${interval}: would deactivate duplicate ${chalk.dim(dup.id)} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        await api.deactivatePlan(dup.id);
        console.log(`        ${chalk.yellow('↓')} ${interval}: deactivated duplicate ${chalk.dim(dup.id)}`);
      }
    }

    for (const old of stale) {
      if (dryRun) {
        console.log(`        ${chalk.yellow('↓')} ${interval}: would deactivate ${chalk.dim(old.id)} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        await api.deactivatePlan(old.id);
        console.log(`        ${chalk.yellow('↓')} ${interval}: deactivated ${chalk.dim(old.id)}`);
      }
    }

    if (match) {
      continue;
    }

    // Create new plan
    const planName = `${productDisplayName(brandConfig, product)} (${interval.charAt(0).toUpperCase() + interval.slice(1)})`;

    if (dryRun) {
      console.log(`        ${chalk.cyan('+')} ${interval}: would create $${expectedAmount} plan "${planName}" ${chalk.yellow('[DRY RUN]')}`);
    } else {
      const newPlan = await api.createPlan({
        productId: paypalProductId,
        name: planName,
        interval,
        amount: expectedAmount,
        trialDays,
      });
      console.log(`        ${chalk.green('✓')} ${interval}: created $${expectedAmount} ${chalk.cyan(newPlan.id)}`);
    }
  }
}

/**
 * Deactivate active plans on legacy PayPal products
 * (product.paypal.legacyProductIds). Existing subscribers keep their plans;
 * no new subscriptions can be created on them.
 */
async function deactivateLegacyPlans(api, products, dryRun) {
  const legacyIds = new Set();
  for (const product of products) {
    for (const id of product.paypal?.legacyProductIds || []) {
      legacyIds.add(id);
    }
  }

  if (legacyIds.size === 0) {
    return;
  }

  console.log(`      ${chalk.dim('Legacy PayPal products:')}`);

  for (const legacyProductId of legacyIds) {
    const plans = await api.listPlansForProduct(legacyProductId);
    const activePlans = plans.filter((p) => p.status === 'ACTIVE');

    if (activePlans.length === 0) {
      console.log(`        ${chalk.green('✓')} ${chalk.dim(legacyProductId)}: no active plans`);
      continue;
    }

    for (const plan of activePlans) {
      if (dryRun) {
        console.log(`        ${chalk.yellow('↓')} ${chalk.dim(legacyProductId)}: would deactivate ${plan.name} ${chalk.dim(plan.id)} ${chalk.yellow('[DRY RUN]')}`);
      } else {
        await api.deactivatePlan(plan.id);
        console.log(`        ${chalk.yellow('↓')} ${chalk.dim(legacyProductId)}: deactivated ${plan.name} ${chalk.dim(plan.id)}`);
      }
    }
  }
}

/**
 * Sandbox only: the fixtures just ensured can be bought only by a sandbox
 * BUYER account, and PayPal exposes no API to mint one (probed 2026-08-18,
 * #348 — the app-credential token carries no sandbox-account scope), so the
 * walk reminds the operator instead of precreating it. Live runs say nothing.
 */
function remindSandboxBuyer(api) {
  if (api.getAccountInfo().environment !== 'sandbox') {
    return;
  }

  console.log(`      ${chalk.yellow('⚠')} Sandbox — buying the QA fixture (proof-press) through guest checkout needs a sandbox BUYER account (no API mints one)`);
  console.log(`      ${chalk.dim('→')} Sandbox → Accounts: ${chalk.cyan(SANDBOX_ACCOUNTS_URL)} ${chalk.dim(`· runbook: ${SANDBOX_QA_RUNBOOK}`)}`);
}

module.exports = async function ensurePayPalProducts(context) {
  const { brandConfig, paypalApi: api, options } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ PayPal not configured')}`);
    return {};
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} No changes will be made`);
  }

  const products = paidProducts(brandConfig);
  const configEdits = {};
  let catalog = null; // Lazy-listed only when a product has no configured ID

  for (const product of products) {
    console.log(`      ${chalk.bold(product.name)} (${product.id}):`);

    const desired = buildProductDetails(brandConfig, product);

    // --- Resolve the PayPal catalog product: config → name match → create ---
    let paypalId = product.paypal?.productId || null;
    let paypalProduct = null;

    if (!paypalId) {
      // Self-heal: the catalog list is summarized, so a name match still
      // needs a full fetch before diffing
      catalog = catalog || await api.listProducts();
      const match = catalog.find((p) => p.name === desired.name);
      if (match) {
        paypalId = match.id;
        console.log(`        ${chalk.green('✓')} Matched existing product by name: ${chalk.dim(match.id)}`);
      }
    }

    if (paypalId) {
      paypalProduct = await api.getProduct(paypalId);
      console.log(`        ${chalk.green('✓')} Product exists: ${chalk.dim(paypalProduct.id)}`);

      const patches = getProductUpdates(paypalProduct, desired);
      if (patches) {
        const fields = patches.map((p) => p.path.slice(1)).join(', ');
        if (dryRun) {
          console.log(`        ${chalk.cyan('~')} Would update: ${chalk.dim(fields)} ${chalk.yellow('[DRY RUN]')}`);
        } else {
          await api.updateProduct(paypalProduct.id, patches);
          console.log(`        ${chalk.green('✓')} Updated: ${chalk.dim(fields)}`);
        }
      }
    } else {
      if (dryRun) {
        console.log(`        ${chalk.cyan('+')} Would create product: ${chalk.dim(desired.name)} ${chalk.yellow('[DRY RUN]')}`);
        // Can't manage plans without a real product ID
        continue;
      }

      paypalProduct = await api.createProduct({
        name: desired.name,
        description: desired.description,
        type: product.type === 'subscription' ? 'SERVICE' : 'DIGITAL',
        imageUrl: desired.imageUrl,
        homeUrl: desired.homeUrl,
      });
      console.log(`        ${chalk.green('✓')} Created product: ${chalk.cyan(paypalProduct.id)}`);
    }

    if (paypalProduct.id !== product.paypal?.productId) {
      configEdits[`payment.products[id=${product.id}].paypal.productId`] = paypalProduct.id;
    }

    // --- Ensure billing plans match config (subscriptions only) ---
    if (product.type === 'subscription') {
      await ensurePlans(api, paypalProduct.id, product, brandConfig, dryRun);
    } else {
      console.log(`        ${chalk.dim('⊘ One-time — no plans needed (Orders API)')}`);
    }
  }

  if (Object.keys(configEdits).length > 0) {
    writeBrandConfig(context, configEdits);
  }

  // --- Deactivate plans on legacy products ---
  await deactivateLegacyPlans(api, products, dryRun);

  // --- The fixtures exist; a sandbox drive still needs a buyer ---
  remindSandboxBuyer(api);

  return { output: { paypalSync: { productsProcessed: products.length } } };
};
