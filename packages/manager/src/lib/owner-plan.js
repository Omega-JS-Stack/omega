/**
 * Shared comp-plan reconciliation for the operator-product services
 * (slapform, chatsy, replyify): the brand's owner account on the product is
 * set to the configured plan as an internal comp.
 *
 * Diff-synced on the subscription's leaf fields, and the patch masks only
 * those leaves — sibling subscription fields written by the product's own
 * backend (trial, cancellation flags, …) survive, exactly like the admin
 * SDK merge-write this replaces. A missing user document is created by the
 * same patch.
 */
const chalk = require('chalk').default;

const SUBSCRIPTION_FIELD_PATHS = [
  'subscription.product.id',
  'subscription.product.name',
  'subscription.status',
  'subscription.payment.processor',
  'subscription.payment.frequency',
  'subscription.payment.price',
  'subscription.payment.resourceId',
  'subscription.payment.orderId',
];

/**
 * Ensure the owner account's subscription matches the comp plan.
 *
 * @param {Object} params
 * @param {Object} params.db - FirestoreREST client (or test fake)
 * @param {string} params.ownerUid - The owner account's UID
 * @param {{ id: string, name: string }} params.plan - The plan to grant
 * @param {boolean} params.dryRun - Report the patch instead of writing it
 * @returns {'synced'|'planned'|'updated'}
 */
async function ensureOwnerPlan({ db, ownerUid, plan, dryRun }) {
  // Subscription shape matches the @omegajs/backend user schema
  const desired = {
    product: { id: plan.id, name: plan.name },
    status: 'active',
    payment: {
      processor: 'internal',
      frequency: 'annually',
      price: 0,
      resourceId: null,
      orderId: null,
    },
  };

  const user = await db.getDoc(`users/${ownerUid}`);
  const sub = user?.subscription || {};

  const drifted = sub.product?.id !== plan.id
    || sub.product?.name !== plan.name
    || sub.status !== 'active'
    || sub.payment?.processor !== 'internal'
    || sub.payment?.frequency !== 'annually'
    || sub.payment?.price !== 0
    || (sub.payment?.resourceId ?? null) !== null
    || (sub.payment?.orderId ?? null) !== null;

  if (!drifted) {
    console.log(`      ${chalk.green('✓')} User ${chalk.dim(ownerUid)} already on ${chalk.cyan(plan.name)} plan ${chalk.dim('(internal)')}`);
    return 'synced';
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would set user ${chalk.cyan(ownerUid)} to ${chalk.cyan(plan.name)} plan ${chalk.dim('(internal)')}`);
    return 'planned';
  }

  await db.patchDoc(`users/${ownerUid}`, { subscription: desired }, SUBSCRIPTION_FIELD_PATHS);

  console.log(`      ${chalk.green('✓')} User ${chalk.dim(ownerUid)} set to ${chalk.cyan(plan.name)} plan ${chalk.dim('(internal)')}`);

  return 'updated';
}

module.exports = { ensureOwnerPlan, SUBSCRIPTION_FIELD_PATHS };
