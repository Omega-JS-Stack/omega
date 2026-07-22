/**
 * Ensure a Stripe webhook endpoint exists for this brand's backend.
 *
 * Matches by exact URL, re-enables endpoints Stripe auto-disabled after
 * repeated failures, diffs enabled_events, updates when drifted, creates
 * when missing. Skipped for shared Firebase projects (no api.{domain}
 * backend to receive events). Requires OMEGA_WEBHOOK_KEY.
 */
const chalk = require('chalk').default;
const { buildWebhookUrl, diffEventSets, redactWebhookUrl } = require('../lib/payment-utils.js');

// Events the backend handles for subscription/payment processing
const ENABLED_EVENTS = [
  // Subscriptions
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',

  // Invoices (subscription renewals + failed payments)
  'invoice.created',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',

  // One-time purchases (Checkout + charges)
  'checkout.session.completed',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',

  // Payment intents (covers both subscription and one-time)
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

module.exports = async function ensureStripeWebhook(context) {
  const { brandConfig, stripeApi: api, options } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Stripe not configured')}`);
    return {};
  }

  // Shared Firebase project — no backend deploys from this brand, so api.{domain} doesn't exist
  if (brandConfig.firebase?.shared === true) {
    console.log(`      ${chalk.dim('⊘ Shared Firebase project — no brand API for webhooks')}`);
    return {};
  }

  if (!process.env.OMEGA_WEBHOOK_KEY) {
    console.log(`      ${chalk.yellow('⚠')} OMEGA_WEBHOOK_KEY not set in the brand .env — webhook not managed`);
    return { status: 'warned', output: { stripeWebhook: { skipped: 'no OMEGA_WEBHOOK_KEY' } } };
  }

  const desiredUrl = buildWebhookUrl(brandConfig, 'stripe');

  const { data: webhooks = [] } = await api.listWebhookEndpoints();
  const existing = webhooks.find((wh) => wh.url === desiredUrl);

  if (existing) {
    // Re-enable if disabled (Stripe auto-disables after too many failures)
    if (existing.status === 'disabled') {
      if (dryRun) {
        console.log(`      ${chalk.cyan('~')} Would re-enable disabled webhook ${chalk.yellow('[DRY RUN]')}`);
      } else {
        console.log(`      ${chalk.yellow('⚠')} Webhook is disabled — re-enabling...`);
        await api.updateWebhookEndpoint(existing.id, { disabled: false });
        console.log(`      ${chalk.green('✓')} Webhook re-enabled`);
      }
    }

    const diff = diffEventSets(existing.enabled_events || [], ENABLED_EVENTS);

    if (!diff) {
      console.log(`      ${chalk.green('✓')} Webhook up to date ${chalk.dim(`(${existing.id})`)}`);
      return { output: { stripeWebhook: { id: existing.id, updated: false } } };
    }

    if (diff.missing.length > 0) {
      console.log(`      Adding events: ${chalk.cyan(diff.missing.join(', '))}`);
    }
    if (diff.extra.length > 0) {
      console.log(`      Removing events: ${chalk.dim(diff.extra.join(', '))}`);
    }

    if (dryRun) {
      console.log(`      ${chalk.cyan('~')} Would update webhook events ${chalk.yellow('[DRY RUN]')}`);
      return { output: { stripeWebhook: { id: existing.id, planned: 'update' } } };
    }

    await api.updateWebhookEndpoint(existing.id, { enabled_events: ENABLED_EVENTS });
    console.log(`      ${chalk.green('✓')} Webhook events updated ${chalk.dim(`(${existing.id})`)}`);

    return { output: { stripeWebhook: { id: existing.id, updated: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.cyan('+')} Would create webhook ${chalk.yellow('[DRY RUN]')}`);
    console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);
    return { output: { stripeWebhook: { planned: 'create' } } };
  }

  const webhook = await api.createWebhookEndpoint(desiredUrl, ENABLED_EVENTS);
  console.log(`      ${chalk.green('✓')} Webhook created: ${chalk.dim(webhook.id)}`);
  console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);

  return { output: { stripeWebhook: { id: webhook.id, created: true } } };
};
