/**
 * Ensure the brand's Slapform owner account has the configured plan.
 *
 * The form's owner UID identifies the user account; that user's
 * subscription is set to forms.providers.slapform.plan (DEFAULTS: Slapform's Grandmaster
 * top tier) via the shared owner-plan reconciliation. omega-manager
 * resolved the plan by reading the slapform brand's own config from
 * `.brands/` (company mode); the port takes it from the brand's config
 * with the top tier as the default.
 */
const chalk = require('chalk').default;
const { ensureOwnerPlan } = require('../../../lib/owner-plan.js');

module.exports = async function ensureUser(context) {
  const { brandConfig, db, formId, options } = context;

  const plan = brandConfig.forms?.providers?.slapform?.plan;
  if (!plan?.id) {
    console.log(`      ${chalk.red('✗')} No forms.providers.slapform.plan configured`);
    return { status: 'error', error: 'no forms.providers.slapform.plan.id configured' };
  }

  // The form document carries the owner UID
  const form = await db.getDoc(`forms/${formId}`);

  if (!form) {
    console.log(`      ${chalk.red('✗')} Form ${chalk.cyan(formId)} not found in Slapform — check forms.providers.slapform.formId`);
    return { status: 'error', error: `form ${formId} not found` };
  }

  const ownerUid = form.owner;

  if (!ownerUid) {
    console.log(`      ${chalk.red('✗')} Form ${chalk.cyan(formId)} has no owner field`);
    return { status: 'error', error: `form ${formId} has no owner` };
  }

  const result = await ensureOwnerPlan({ db, ownerUid, plan, dryRun: options?.dryRun || false });

  if (result === 'planned') {
    return { output: { user: { planned: plan.id } } };
  }

  return { state: { ownerUid }, output: { user: { plan: plan.id, [result]: true } } };
};
