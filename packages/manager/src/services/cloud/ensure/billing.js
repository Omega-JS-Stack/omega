/**
 * Ensure the project is on the Blaze plan.
 *
 * omega-manager silently linked a hardcoded company billing account; the
 * account is tri-state config now (#33) — `gcp.billingAccount` set →
 * link it, `false` → the user chose Spark (silent, no nagging), missing →
 * ask in an interactive run (pick from the accounts the authed user can
 * see, or create one in the console; the answer lands in omega.json5) and
 * warn with guidance otherwise.
 */
const chalk = require('chalk').default;
const { resolveConfigValue } = require('../../../lib/config-flow.js');
const { dryRunPlan, needsInteractiveSkip } = require('../../../lib/run-gates.js');

/** Interactive pick/create/opt-out flow — the answer lands in omega.json5. */
function resolveBillingAccount(context, api) {
  return resolveConfigValue(context, {
    path: 'gcp.billingAccount',
    label: 'Billing account',
    instructions: [
      'Blaze (pay-as-you-go) unlocks functions deploys and outbound network.',
      'The account you pick links to this brand\'s projects from now on.',
    ],
    choices: () => api.listBillingAccounts(),
    getName: (account) => `${account.displayName} (${account.name.replace('billingAccounts/', '')})${account.open === false ? ' [closed]' : ''}`,
    getValue: (account) => account.name,
    createNew: {
      label: 'billing account',
      url: 'https://console.cloud.google.com/billing/create',
      refreshChoices: true,
    },
    optOut: { label: 'Stay on the Spark plan (free) — don\'t ask again' },
  });
}

module.exports = async function ensureBilling(context) {
  const { firebaseApi: api, brandConfig, projectId, options = {} } = context;

  // === READ ===
  const billingInfo = await api.getProjectBillingInfo(projectId);

  if (billingInfo?.billingEnabled) {
    console.log(`      ${chalk.green('✓')} Blaze plan enabled`);
    return {
      state: {
        billing: {
          enabled: true,
          billingAccountName: billingInfo.billingAccountName,
        },
      },
    };
  }

  // Tri-state (#33): false = the user chose Spark — a clean state, not a warning
  if (brandConfig.gcp?.billingAccount === false) {
    console.log(`      ${chalk.dim('⊘ Billing opted out (gcp.billingAccount: false) — staying on the Spark plan')}`);
    return { output: { billing: { note: 'billing opted out — Spark plan' } } };
  }

  console.log(`      ${chalk.yellow('⚠')} Project is on the Spark plan (free tier)`);

  const billingAccountName = brandConfig.gcp?.billingAccount
    || await resolveBillingAccount(context, api);

  // The flow may have just landed the opt-out
  if (brandConfig.gcp?.billingAccount === false) {
    return { output: { billing: { note: 'billing opted out — Spark plan' } } };
  }

  if (!billingAccountName) {
    console.log(`      ${chalk.dim('→')} Set gcp.billingAccount ("billingAccounts/XXXXXX-XXXXXX-XXXXXX") in company/brand config to auto-upgrade`);
    console.log(`      ${chalk.dim('→')} Or upgrade manually: ${chalk.cyan(`https://console.firebase.google.com/project/${projectId}/usage/details`)}`);
    return needsInteractiveSkip(
      'billing',
      'pick or create a billing account (the answer lands in omega.json5)',
      'no gcp.billingAccount configured',
    );
  }

  // === WRITE ===
  if (options.dryRun) {
    return dryRunPlan(`link ${billingAccountName} (Blaze plan)`, { output: { billing: { planned: 'link' } } });
  }

  console.log(`      ${chalk.yellow('⏳')} Upgrading to Blaze plan...`);
  try {
    await api.linkBillingAccount(projectId, billingAccountName);
    console.log(`      ${chalk.green('✓')} Upgraded to Blaze plan`);
    return {
      state: {
        billing: {
          enabled: true,
          billingAccountName,
        },
      },
    };
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not upgrade${chalk.dim(`: ${error.message}`)}`);
    return {
      status: 'warned',
      state: { billing: { enabled: false } },
      output: { billing: { error: error.message } },
    };
  }
};
