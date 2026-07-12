/**
 * Ensure the publication's webhook delivers subscription events to the
 * parent @omega.js/backend's forwarder.
 *
 * Publications can be shared across sibling brands, so the webhook always
 * points at the parent (`parent` in omega.json5, 'self' for the parent
 * brand) — the parent reads the brands collection and fans each event out.
 * The webhook is matched by its managed description first (stable across
 * parent moves), then by URL; drift in url/event_types/enabled is patched
 * with the minimum diff.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

// Subscription events @omega.js/backend's consent pipeline consumes (they flip
// consent.marketing.status to 'revoked' and propagate the unsub to SendGrid)
const DESIRED_EVENT_TYPES = [
  'subscription.unsubscribed',
  'subscription.deleted',
  'subscription.paused',
];

const WEBHOOK_DESCRIPTION = '@omega.js/backend consent pipeline (managed by OMEGA — do not edit manually)';

module.exports = async function ensureWebhook(context) {
  const { beehiivApi: api, brandConfig, domain, serviceData, options = {} } = context;

  const publicationId = serviceData.publicationId;
  if (!publicationId) {
    console.log(chalk.dim('      ⊘ No publication yet — nothing to configure a webhook on'));
    return {};
  }

  const parent = brandConfig.parent;
  if (!parent) {
    console.log(chalk.dim('      ⊘ No parent configured — nothing to point the webhook at'));
    console.log(chalk.dim("      → Set parent in omega.json5 ('self' when this brand runs the central backend)"));
    return {};
  }

  if (!process.env.OMEGA_WEBHOOK_KEY) {
    console.log(`      ${chalk.yellow('⚠')} No OMEGA_WEBHOOK_KEY in the brand .env — the forwarder URL can't be built`);
    return { status: 'warned', output: { webhook: { missingWebhookKey: true } } };
  }

  const parentHost = parent === 'self'
    ? domain
    : parent.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const desiredUrl = `https://api.${parentHost}/omega/marketing/webhook/forward?provider=beehiiv&key=${process.env.OMEGA_WEBHOOK_KEY}`;

  const webhooks = await api.listWebhooks(publicationId);

  // The managed description is the primary key — it survives URL changes
  // when a brand moves parents
  const existing = webhooks.find((wh) => wh.description === WEBHOOK_DESCRIPTION)
    || webhooks.find((wh) => wh.url === desiredUrl);

  if (existing) {
    const patch = {};
    if (existing.url !== desiredUrl) {
      patch.url = desiredUrl;
    }
    const currentEvents = new Set(existing.event_types || []);
    const eventsMatch = DESIRED_EVENT_TYPES.every((e) => currentEvents.has(e))
      && (existing.event_types || []).every((e) => DESIRED_EVENT_TYPES.includes(e));
    if (!eventsMatch) {
      patch.event_types = DESIRED_EVENT_TYPES;
    }
    if (existing.enabled === false) {
      patch.enabled = true;
    }

    if (Object.keys(patch).length === 0) {
      console.log(`      ${chalk.green('✓')} Webhook up to date ${chalk.dim(`(${existing.id})`)}`);
      return { output: { webhook: { id: existing.id, url: 'converged' } } };
    }

    if (options.dryRun) {
      return dryRunPlan(`patch: ${Object.keys(patch).join(', ')}`, { output: { webhook: { planned: Object.keys(patch) } } });
    }

    await api.updateWebhook(publicationId, existing.id, patch);
    console.log(`      ${chalk.green('✓')} Webhook updated ${chalk.dim(`(${existing.id})`)}`);
    return { output: { webhook: { id: existing.id, updated: Object.keys(patch) } } };
  }

  if (options.dryRun) {
    return dryRunPlan('create the consent-pipeline webhook', { output: { webhook: { planned: ['create'] } } });
  }

  const created = await api.createWebhook(publicationId, {
    url: desiredUrl,
    event_types: DESIRED_EVENT_TYPES,
    description: WEBHOOK_DESCRIPTION,
  });
  const newId = created?.data?.id || created?.id || '(unknown id)';
  console.log(`      ${chalk.green('✓')} Webhook created ${chalk.dim(`(${newId})`)}`);
  console.log(`      ${chalk.dim('→')} ${chalk.dim(`https://api.${parentHost}/omega/marketing/webhook/forward`)}`);

  return { output: { webhook: { id: newId, created: true } } };
};
