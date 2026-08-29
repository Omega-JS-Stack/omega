/**
 * Ensure the account-global SendGrid Event Webhook points at the parent
 * @omega.js/backend's forwarder with the consent-pipeline events enabled.
 *
 * SendGrid supports ONE Event Webhook per account, so it always targets the
 * parent brand (`parent` in omega.json5 — 'self' when this brand IS the
 * parent); the parent fans events out to each brand's own
 * /marketing/webhook endpoint. Sibling brands sharing the account all
 * converge on the same URL + toggle set. Only the consent toggles are
 * managed — tracking toggles (open/click/delivered/…) are not ours to touch.
 * Drift is patched with the minimum diff.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

// The consent-pipeline events @omega.js/backend must receive
const DESIRED_TOGGLES = {
  bounce: true,
  dropped: true,
  spam_report: true,
  unsubscribe: true,
  group_unsubscribe: true,
};

module.exports = async function ensureEventWebhook(context) {
  const { sendgridApi: api, brandConfig, domain, options = {} } = context;

  const parent = brandConfig.parent;
  if (parent === false) {
    // Tri-state: explicit false = deliberate opt-out, no nudge
    console.log(chalk.dim('      ⊘ parent = false — Event Webhook opted out'));
    return {};
  }
  if (!parent) {
    console.log(chalk.dim('      ⊘ No parent configured — nothing to point the Event Webhook at'));
    console.log(chalk.dim("      → Set parent in omega.json5 ('self' when this brand runs the central backend)"));
    return {};
  }

  if (!process.env.OMEGA_WEBHOOK_KEY) {
    // Unreachable by design (#635): the key is OMEGA's own (`generated:` in
    // the env schema) and the campaigns service's setup mints it through the
    // shared contract before any operation runs. Absent here = broken wiring.
    throw new Error('OMEGA_WEBHOOK_KEY absent after the campaigns setup ran — its REQUIRES entry or its requestServiceInput call is missing');
  }

  const parentHost = parent === 'self'
    ? domain
    : parent.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const desiredUrl = `https://api.${parentHost}/omega/marketing/webhook/forward?provider=sendgrid&key=${process.env.OMEGA_WEBHOOK_KEY}`;

  const current = await api.getEventWebhookSettings();

  const patch = {};
  if (current.url !== desiredUrl) {
    patch.url = desiredUrl;
  }
  if (current.enabled !== true) {
    patch.enabled = true;
  }
  for (const [toggle, value] of Object.entries(DESIRED_TOGGLES)) {
    if (current[toggle] !== value) {
      patch[toggle] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    console.log(`      ${chalk.green('✓')} Event Webhook up to date`);
    console.log(`      ${chalk.dim('→')} ${chalk.dim(`https://api.${parentHost}/omega/marketing/webhook/forward`)}`);
    return { output: { eventWebhook: { url: 'converged' } } };
  }

  if (options.dryRun) {
    return dryRunPlan(`patch: ${Object.keys(patch).join(', ')}`, { output: { eventWebhook: { planned: Object.keys(patch) } } });
  }

  if (patch.url) {
    console.log(`      ${chalk.yellow('↻')} Pointing Event Webhook at ${chalk.cyan(`api.${parentHost}`)}'s forwarder`);
  }
  const enablingToggles = Object.keys(patch).filter((key) => key !== 'url' && key !== 'enabled');
  if (enablingToggles.length > 0) {
    console.log(`      ${chalk.yellow('↻')} Enabling events: ${chalk.cyan(enablingToggles.join(', '))}`);
  }

  await api.updateEventWebhookSettings(patch);
  console.log(`      ${chalk.green('✓')} Event Webhook updated`);

  return { output: { eventWebhook: { updated: Object.keys(patch) } } };
};
