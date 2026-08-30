/**
 * Report Stripe Enhanced Dispute Protection status.
 *
 * The Stripe API has no dispute-protection management (Dashboard-only), so
 * this follows the no-API manual-action pattern: print the settings
 * deep-link, confirm interactively, and stay warned until activation is
 * confirmed. A confirmation nothing can re-check is the one kind of
 * reconcile flag config keeps (#434): it lands at
 * `payment.providers.stripe.disputesConfirmed`. Cannot mutate by
 * construction.
 */
const chalk = require('chalk').default;
const { confirm, pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { canPrompt } = require('../../../lib/run-gates.js');

const CONFIG_PATH = 'payment.providers.stripe.disputesConfirmed';

module.exports = async function ensureStripeDisputes(context) {
  const { brandConfig, stripeApi: api, serviceData, options = {} } = context;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Stripe not configured')}`);
    return {};
  }

  if (brandConfig.payment?.providers?.stripe?.disputesConfirmed === true) {
    console.log(`      ${chalk.green('✓')} Enhanced Dispute Protection confirmed`);
    return {};
  }

  const disputesUrl = serviceData.stripeAccountId
    ? `https://dashboard.stripe.com/${serviceData.stripeAccountId}/settings/disputes`
    : 'https://dashboard.stripe.com/settings/disputes';

  console.log(`      ${chalk.yellow('⚠')} No API for dispute protection — activate ${chalk.bold('Enhanced Dispute Protection')} in the Dashboard`);

  if (canPrompt(options)) {
    await pressEnterToOpen(disputesUrl, 'the Stripe dispute settings');
    const done = await confirm({ message: 'Enhanced Dispute Protection activated in the Dashboard?', default: false });
    if (done) {
      writeBrandConfig(context, { [CONFIG_PATH]: true });
      console.log(`      ${chalk.green('✓')} Enhanced Dispute Protection confirmed`);
      return {};
    }
  } else {
    console.log(`      ${chalk.dim('→')} Dispute settings: ${chalk.cyan(disputesUrl)}`);
    console.log(`      ${chalk.dim('→')} (rerun in an interactive terminal to confirm)`);
  }

  return {
    status: 'warned',
    reason: 'Enhanced Dispute Protection not confirmed — activate it in the Stripe Dashboard',
    output: { stripeDisputes: { disputesUrl } },
  };
};
