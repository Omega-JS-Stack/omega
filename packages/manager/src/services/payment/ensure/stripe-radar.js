/**
 * Report the desired Stripe Radar rules.
 *
 * Stripe has no Radar rules API (Dashboard-only), so this follows the
 * no-API manual-action pattern (search-console ga-link): print the desired
 * rules + the Dashboard deep-link, confirm interactively, and stay warned
 * until confirmed (`radarConfirmed` in state). Rules come from
 * payment.processors.stripe.radar — manager defaults with per-brand
 * override. Cannot mutate by construction.
 */
const chalk = require('chalk').default;
const { confirm, pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { canPrompt } = require('../../../lib/run-gates.js');

module.exports = async function ensureStripeRadar(context) {
  const { brandConfig, stripeApi: api, serviceData, options = {} } = context;

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

  if (canPrompt(options)) {
    await pressEnterToOpen(radarUrl, 'the Stripe Radar rules page');
    const done = await confirm({ message: 'Radar rules added in the Dashboard?', default: false });
    if (done) {
      console.log(`      ${chalk.green('✓')} Radar rules confirmed (${desiredRules.length} rules)`);
      return { state: { radarConfirmed: true } };
    }
  } else {
    console.log(`      ${chalk.dim('→')} Radar rules: ${chalk.cyan(radarUrl)}`);
    console.log(`      ${chalk.dim('→')} (rerun in an interactive terminal to confirm)`);
  }

  return {
    status: 'warned',
    state: { radarConfirmed: false },
    output: { stripeRadar: { rules: desiredRules.length, radarUrl } },
  };
};
