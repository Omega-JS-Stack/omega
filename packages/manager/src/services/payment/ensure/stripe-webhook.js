/**
 * Ensure a Stripe webhook endpoint exists for this brand's backend.
 *
 * Matches by exact URL, deletes every OTHER endpoint on the brand's API host
 * (stale twins — one endpoint per host, and endpoints on other hosts are never
 * touched), re-enables endpoints Stripe auto-disabled after repeated failures,
 * diffs enabled_events, updates when drifted, creates when missing. Skipped for
 * shared Firebase projects (no api.{domain} backend to receive events).
 * Requires OMEGA_WEBHOOK_KEY.
 */
const chalk = require('chalk').default;
const { buildWebhookUrl, diffEventSets, redactWebhookUrl, staleWebhookEndpoints } = require('../lib/payment-utils.js');

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
  if (brandConfig.cloud?.shared === true) {
    console.log(`      ${chalk.dim('⊘ Shared Firebase project — no brand API for webhooks')}`);
    return {};
  }

  if (!process.env.OMEGA_WEBHOOK_KEY) {
    // Unreachable by design (#635): the key is OMEGA's own (`generated:` in
    // the env schema) and the payment service's setup mints it through the
    // shared contract before any operation runs. Absent here = broken wiring.
    throw new Error('OMEGA_WEBHOOK_KEY absent after the payment setup ran — its REQUIRES entry or its requestServiceInput call is missing');
  }

  const desiredUrl = buildWebhookUrl(brandConfig, 'stripe');

  const { data: webhooks = [] } = await api.listWebhookEndpoints();

  // Exactly ONE endpoint on the brand's API host: the desired URL. Legacy twins
  // there receive every event and answer 400 forever (#570).
  for (const stale of staleWebhookEndpoints(webhooks, desiredUrl)) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('-')} Would delete stale webhook ${chalk.dim(redactWebhookUrl(stale.url))} ${chalk.yellow('[DRY RUN]')}`);
      continue;
    }

    await api.deleteWebhookEndpoint(stale.id);
    console.log(`      ${chalk.yellow('⚠')} Deleted stale webhook ${chalk.dim(`(${stale.id})`)} ${redactWebhookUrl(stale.url)}`);
  }

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
