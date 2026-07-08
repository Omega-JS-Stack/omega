/**
 * Ensure the brand's Slapform owner account has the configured plan.
 *
 * The form's owner UID identifies the user account; that user's
 * subscription is set to slapform.plan (DEFAULTS: Slapform's Grandmaster
 * top tier) as an internal comp so the brand has full access.
 * omega-manager resolved the plan by reading the slapform brand's own
 * config from `.brands/` (company mode); the port takes it from the
 * brand's config with the top tier as the default.
 *
 * Diff-synced on the subscription's leaf fields, and the patch masks only
 * those leaves — sibling subscription fields written by Slapform's backend
 * (trial, cancellation flags, …) survive, exactly like the admin SDK
 * merge-write this replaces.
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

module.exports = async function ensureUser(context) {
  const { brandConfig, db, formId, options } = context;
  const dryRun = options?.dryRun || false;

  const plan = brandConfig.slapform?.plan;
  if (!plan?.id) {
    console.log(`      ${chalk.red('✗')} No slapform.plan configured`);
    return { status: 'error', error: 'no slapform.plan.id configured' };
  }

  // The form document carries the owner UID
  const form = await db.getDoc(`forms/${formId}`);

  if (!form) {
    console.log(`      ${chalk.red('✗')} Form ${chalk.cyan(formId)} not found in Slapform — check slapform.formId`);
    return { status: 'error', error: `form ${formId} not found` };
  }

  const ownerUid = form.owner;

  if (!ownerUid) {
    console.log(`      ${chalk.red('✗')} Form ${chalk.cyan(formId)} has no owner field`);
    return { status: 'error', error: `form ${formId} has no owner` };
  }

  // Subscription shape matches the BEM user schema
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
    return { state: { ownerUid }, output: { user: { plan: plan.id, synced: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would set user ${chalk.cyan(ownerUid)} to ${chalk.cyan(plan.name)} plan ${chalk.dim('(internal)')}`);
    return { output: { user: { planned: plan.id } } };
  }

  await db.patchDoc(`users/${ownerUid}`, { subscription: desired }, SUBSCRIPTION_FIELD_PATHS);

  console.log(`      ${chalk.green('✓')} User ${chalk.dim(ownerUid)} set to ${chalk.cyan(plan.name)} plan ${chalk.dim('(internal)')}`);

  return { state: { ownerUid }, output: { user: { plan: plan.id, updated: true } } };
};
