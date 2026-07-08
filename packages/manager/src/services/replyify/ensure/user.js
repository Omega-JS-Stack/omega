/**
 * Ensure the brand's Replyify owner account has the configured plan.
 *
 * The agent's owner UID identifies the user account; that user's
 * subscription is set to replyify.plan (DEFAULTS: Replyify's Max top tier)
 * via the shared owner-plan reconciliation. omega-manager resolved the
 * plan by reading the replyify brand's own config from `.brands/` (company
 * mode); the port takes it from the brand's config with the top tier as
 * the default.
 */
const chalk = require('chalk').default;
const { ensureOwnerPlan } = require('../../../lib/owner-plan.js');

module.exports = async function ensureUser(context) {
  const { brandConfig, db, agentId, options } = context;

  const plan = brandConfig.replyify?.plan;
  if (!plan?.id) {
    console.log(`      ${chalk.red('✗')} No replyify.plan configured`);
    return { status: 'error', error: 'no replyify.plan.id configured' };
  }

  // The agent document carries the owner UID
  const agent = await db.getDoc(`agents/${agentId}`);

  if (!agent) {
    console.log(`      ${chalk.red('✗')} Agent ${chalk.cyan(agentId)} not found in Replyify — check replyify.agentId`);
    return { status: 'error', error: `agent ${agentId} not found` };
  }

  const ownerUid = agent.owner;

  if (!ownerUid) {
    console.log(`      ${chalk.red('✗')} Agent ${chalk.cyan(agentId)} has no owner field`);
    return { status: 'error', error: `agent ${agentId} has no owner` };
  }

  const result = await ensureOwnerPlan({ db, ownerUid, plan, dryRun: options?.dryRun || false });

  if (result === 'planned') {
    return { output: { user: { planned: plan.id } } };
  }

  return { state: { ownerUid }, output: { user: { plan: plan.id, [result]: true } } };
};
