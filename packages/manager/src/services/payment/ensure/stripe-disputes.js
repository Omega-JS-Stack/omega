/**
 * Report Stripe Enhanced Dispute Protection status.
 *
 * The Stripe API has no dispute-protection management (Dashboard-only), so
 * this follows the no-API manual-action pattern: print the settings
 * deep-link and stay warned until activation is confirmed
 * (`disputesConfirmed` in state; the confirm prompt rides the prompting
 * port). Cannot mutate by construction.
 */
const chalk = require('chalk').default;

module.exports = async function ensureStripeDisputes(context) {
  const { stripeApi: api, serviceData } = context;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Stripe not configured')}`);
    return {};
  }

  if (serviceData.disputesConfirmed === true) {
    console.log(`      ${chalk.green('✓')} Enhanced Dispute Protection confirmed`);
    return { state: { disputesConfirmed: true } };
  }

  const disputesUrl = serviceData.stripeAccountId
    ? `https://dashboard.stripe.com/${serviceData.stripeAccountId}/settings/disputes`
    : 'https://dashboard.stripe.com/settings/disputes';

  console.log(`      ${chalk.yellow('⚠')} No API for dispute protection — activate ${chalk.bold('Enhanced Dispute Protection')} in the Dashboard`);
  console.log(`      ${chalk.dim('→')} Dispute settings: ${chalk.cyan(disputesUrl)}`);
  console.log(`      ${chalk.dim('→')} (the confirmation prompt rides the prompting port)`);

  return {
    status: 'warned',
    state: { disputesConfirmed: false },
    output: { stripeDisputes: { disputesUrl } },
  };
};
