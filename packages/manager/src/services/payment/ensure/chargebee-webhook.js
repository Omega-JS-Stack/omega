/**
 * Ensure a Chargebee webhook endpoint exists for this brand's backend.
 *
 * Matches by exact URL (which carries &brand={brandId} — Chargebee sites
 * can serve multiple brands), re-enables disabled endpoints, creates when
 * missing. Chargebee's API doesn't return enabled_events, so event drift
 * can't be diffed — events are set on create only (delete + recreate to
 * change them). Skipped for shared Firebase projects. Requires
 * OMEGA_WEBHOOK_KEY.
 */
const chalk = require('chalk').default;
const { buildWebhookUrl, redactWebhookUrl } = require('../lib/payment-utils.js');

// Events the backend handles for Chargebee subscription/payment processing
const ENABLED_EVENTS = [
  // Subscriptions
  'subscription_created',
  'subscription_started',
  'subscription_activated',
  'subscription_changed',
  'subscription_cancelled',
  'subscription_paused',
  'subscription_resumed',
  'subscription_renewed',
  'subscription_reactivated',
  'subscription_trial_end_reminder',

  // Payments
  'payment_succeeded',
  'payment_failed',
  'payment_refunded',

  // Invoices
  'invoice_generated',
  'invoice_updated',
];

module.exports = async function ensureChargebeeWebhook(context) {
  const { brandConfig, brandId, chargebeeApi: api, options } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ Chargebee not configured')}`);
    return {};
  }

  // Shared Firebase project — no backend deploys from this brand, so api.{domain} doesn't exist
  if (brandConfig.cloud?.shared === true) {
    console.log(`      ${chalk.dim('⊘ Shared Firebase project — no brand API for webhooks')}`);
    return {};
  }

  if (!process.env.OMEGA_WEBHOOK_KEY) {
    console.log(`      ${chalk.yellow('⚠')} OMEGA_WEBHOOK_KEY not set in the brand .env — webhook not managed`);
    return { status: 'warned', output: { chargebeeWebhook: { skipped: 'no OMEGA_WEBHOOK_KEY' } } };
  }

  const desiredUrl = buildWebhookUrl(brandConfig, 'chargebee', brandId);

  const webhooks = await api.listWebhooks();
  const existing = webhooks.find((wh) => wh.url === desiredUrl);

  if (existing) {
    if (existing.disabled === true) {
      if (dryRun) {
        console.log(`      ${chalk.cyan('~')} Would re-enable disabled webhook ${chalk.yellow('[DRY RUN]')}`);
        return { output: { chargebeeWebhook: { id: existing.id, planned: 'enable' } } };
      }

      console.log(`      ${chalk.yellow('⚠')} Webhook is disabled — re-enabling...`);
      await api.updateWebhook(existing.id, { status: 'active' });
      console.log(`      ${chalk.green('✓')} Webhook re-enabled ${chalk.dim(`(${existing.id})`)}`);
    } else {
      console.log(`      ${chalk.green('✓')} Webhook active ${chalk.dim(`(${existing.id})`)}`);
    }

    console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);

    // Chargebee doesn't return enabled_events, so event drift can't be
    // checked here — events are set on create only.
    return { output: { chargebeeWebhook: { id: existing.id } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.cyan('+')} Would create webhook ${chalk.yellow('[DRY RUN]')}`);
    console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);
    console.log(`      ${chalk.dim(`Events: ${ENABLED_EVENTS.length} event types`)}`);
    return { output: { chargebeeWebhook: { planned: 'create' } } };
  }

  const webhookName = `${brandConfig.brand.name} Backend`;
  const webhook = await api.createWebhook({ url: desiredUrl, name: webhookName, eventTypes: ENABLED_EVENTS });
  console.log(`      ${chalk.green('✓')} Webhook created: ${chalk.dim(webhook.id)}`);
  console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);

  return { output: { chargebeeWebhook: { id: webhook.id, created: true } } };
};
