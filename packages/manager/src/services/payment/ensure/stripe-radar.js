/**
 * Report the desired Stripe Radar rules.
 *
 * Stripe has no Radar rules API (Dashboard-only), so this follows the
 * no-API manual-action pattern (search-console ga-link): print the desired
 * rules + the Dashboard deep-link and stay warned until the setup is
 * confirmed (`radarConfirmed` in state; the confirm prompt rides the
 * prompting port). Rules come from payment.processors.stripe.radar —
 * manager defaults with per-brand override. Cannot mutate by construction.
 */
const chalk = require('chalk').default;

module.exports = async function ensureStripeRadar(context) {
  const { brandConfig, stripeApi: api, serviceData } = context;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Stripe not configured')}`);
    return {};
  }

  const desiredRules = brandConfig.payment?.processors?.stripe?.radar || [];
  if (desiredRules.length === 0) {
    console.log(`      ${chalk.dim('⊘ No Radar rules configured')}`);
    return {};
  }

  if (serviceData.radarConfirmed === true) {
    console.log(`      ${chalk.green('✓')} Radar rules confirmed (${desiredRules.length} rules)`);
    return { state: { radarConfirmed: true } };
  }

  const radarUrl = serviceData.stripeAccountId
    ? `https://dashboard.stripe.com/${serviceData.stripeAccountId}/radar/rules`
    : 'https://dashboard.stripe.com/radar/rules';

  console.log(`      ${chalk.yellow('⚠')} Stripe has no Radar rules API — add these in the Dashboard:`);
  console.log('');
  for (const rule of desiredRules) {
    const actionColor = rule.action === 'block' ? chalk.red
      : rule.action === 'review' ? chalk.yellow
      : chalk.cyan;
    console.log(`        ${actionColor(rule.action.padEnd(24))} ${chalk.dim(rule.predicate)}`);
    if (rule.description) {
      console.log(`        ${' '.repeat(24)} ${chalk.dim(`↳ ${rule.description}`)}`);
    }
  }
  console.log('');
  console.log(`      ${chalk.dim('→')} Radar rules: ${chalk.cyan(radarUrl)}`);
  console.log(`      ${chalk.dim('→')} (the confirmation prompt rides the prompting port)`);

  return {
    status: 'warned',
    state: { radarConfirmed: false },
    output: { stripeRadar: { rules: desiredRules.length, radarUrl } },
  };
};
