/**
 * Ensure a PayPal webhook endpoint exists for this brand's backend.
 *
 * Matches by exact URL, deletes every OTHER endpoint on the brand's API host
 * (stale twins — one endpoint per host, and endpoints on other hosts are never
 * touched), diffs event_types, PATCHes when drifted, creates when missing.
 * Skipped for shared Firebase projects (no api.{domain} backend to receive
 * events). Requires OMEGA_WEBHOOK_KEY.
 */
const chalk = require('chalk').default;
const { buildWebhookUrl, diffEventSets, redactWebhookUrl, staleWebhookEndpoints } = require('../lib/payment-utils.js');

// Events the backend handles for PayPal subscription/payment processing
const ENABLED_EVENTS = [
  // Subscriptions
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',

  // One-time purchases (Orders/Checkout)
  'CHECKOUT.ORDER.COMPLETED',
  'CHECKOUT.ORDER.APPROVED',

  // Payment captures and sales
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.DENIED',
  'PAYMENT.SALE.REFUNDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',

  // Invoices
  'INVOICING.INVOICE.CREATED',
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
];

module.exports = async function ensurePayPalWebhook(context) {
  const { brandConfig, paypalApi: api, options } = context;
  const dryRun = options?.dryRun || false;

  if (!api) {
    console.log(`      ${chalk.dim('⊘ PayPal not configured')}`);
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

  const desiredUrl = buildWebhookUrl(brandConfig, 'paypal');

  const { webhooks = [] } = await api.listWebhooks();

  // Exactly ONE endpoint on the brand's API host: the desired URL. Legacy twins
  // there receive every event and answer 400 forever (#570).
  for (const stale of staleWebhookEndpoints(webhooks, desiredUrl)) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('-')} Would delete stale webhook ${chalk.dim(redactWebhookUrl(stale.url))} ${chalk.yellow('[DRY RUN]')}`);
      continue;
    }

    await api.deleteWebhook(stale.id);
    console.log(`      ${chalk.yellow('⚠')} Deleted stale webhook ${chalk.dim(`(${stale.id})`)} ${redactWebhookUrl(stale.url)}`);
  }

  const existing = webhooks.find((wh) => wh.url === desiredUrl);

  if (existing) {
    const currentEvents = (existing.event_types || []).map((e) => e.name || e);
    const diff = diffEventSets(currentEvents, ENABLED_EVENTS);

    if (!diff) {
      console.log(`      ${chalk.green('✓')} Webhook up to date ${chalk.dim(`(${existing.id})`)}`);
      return { output: { paypalWebhook: { id: existing.id, updated: false } } };
    }

    if (diff.missing.length > 0) {
      console.log(`      Adding events: ${chalk.cyan(diff.missing.join(', '))}`);
    }
    if (diff.extra.length > 0) {
      console.log(`      Removing events: ${chalk.dim(diff.extra.join(', '))}`);
    }

    if (dryRun) {
      console.log(`      ${chalk.cyan('~')} Would update webhook events ${chalk.yellow('[DRY RUN]')}`);
      return { output: { paypalWebhook: { id: existing.id, planned: 'update' } } };
    }

    // PayPal webhook update uses JSON Patch to replace event_types
    await api.updateWebhook(existing.id, [
      {
        op: 'replace',
        path: '/event_types',
        value: ENABLED_EVENTS.map((name) => ({ name })),
      },
    ]);
    console.log(`      ${chalk.green('✓')} Webhook events updated ${chalk.dim(`(${existing.id})`)}`);

    return { output: { paypalWebhook: { id: existing.id, updated: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.cyan('+')} Would create webhook ${chalk.yellow('[DRY RUN]')}`);
    console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);
    return { output: { paypalWebhook: { planned: 'create' } } };
  }

  const webhook = await api.createWebhook(desiredUrl, ENABLED_EVENTS);
  console.log(`      ${chalk.green('✓')} Webhook created: ${chalk.dim(webhook.id)}`);
  console.log(`      ${chalk.dim(redactWebhookUrl(desiredUrl))}`);

  return { output: { paypalWebhook: { id: webhook.id, created: true } } };
};
