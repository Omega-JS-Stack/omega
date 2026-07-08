/**
 * Ensure the project is on the Blaze plan.
 *
 * omega-manager silently linked a hardcoded company billing account; the
 * account is config now (`firebase.billingAccount`) — unconfigured projects
 * on Spark warn with guidance instead of linking someone's card.
 */
const chalk = require('chalk').default;

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

  console.log(`      ${chalk.yellow('⚠')} Project is on the Spark plan (free tier)`);

  const billingAccountName = brandConfig.firebase?.billingAccount;

  if (!billingAccountName) {
    console.log(`      ${chalk.dim('→')} Set firebase.billingAccount ("billingAccounts/XXXXXX-XXXXXX-XXXXXX") in company/brand config to auto-upgrade`);
    console.log(`      ${chalk.dim('→')} Or upgrade manually: ${chalk.cyan(`https://console.firebase.google.com/project/${projectId}/usage/details`)}`);
    return { status: 'warned', output: { billing: { note: 'no firebase.billingAccount configured' } } };
  }

  // === WRITE ===
  if (options.dryRun) {
    console.log(`      ${chalk.dim(`⊘ Dry run — would link ${billingAccountName} (Blaze plan)`)}`);
    return { output: { billing: { planned: 'link' } } };
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
