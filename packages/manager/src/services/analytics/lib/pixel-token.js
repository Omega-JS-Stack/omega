/**
 * Shared pixel-token machinery for the meta-pixel/tiktok-pixel operations —
 * ONE acquisition flow, used by both halves of the pair: the CREATE path
 * needs the token before it can provision (lib/pixel-provision.js) and the
 * CHECK path needs it before the frontend can send conversions.
 *
 * The pixel ID is public config (`analytics.providers.{provider}.id` — it
 * ships in the frontend); the conversions/events access token is a secret
 * and lives in the brand .env under the exact name @omega.js/backend reads.
 * There's no practical validation API for either token, so this is a
 * presence check plus an ask — and the ask is the SHARED setup contract
 * (#608, lib/service-input.js): provide (the Enter-gated open of the exact
 * page that mints one, then a masked paste saved to the brand .env), skip
 * this run, or disable the provider for good (`analytics.providers.
 * {provider}: false`). Non-interactive runs never prompt and keep the warned
 * guidance. The disperse service composes the saved token into the backend's
 * app .env; the stage step carries it into dist/.
 *
 * A provider whose token is MINTED rather than pasted names its own acquire
 * on the spec (TikTok's portal exchange, #448) — the outcomes are identical.
 */
const chalk = require('chalk').default;

const { serviceInputSpec } = require('../../../config.js');
const { requestServiceInput } = require('../../../lib/service-input.js');

/**
 * Make sure the provider's access token is in the environment, asking for
 * it when the run can prompt. Silent when the token is already set — the
 * caller reports it (the create path stays quiet, the check path prints its
 * ✓ line).
 *
 * @param {Object} context - Handler context
 * @param {Object} spec - A pixel spec ({ key, label, envVar, acquire?, instructions? })
 * @param {Object} [options] - { gate: false } when the caller already ran the
 *   Provide / Skip / Disable gate for this provider.
 * @returns {Promise<boolean>} - Whether the token is now in process.env
 */
async function acquirePixelToken(context, spec, options = {}) {
  if (process.env[spec.envVar]) {
    return true;
  }

  if (spec.acquire) {
    return spec.acquire(context, spec, options);
  }

  const gate = await requestServiceInput(context, serviceInputSpec('analytics', {
    names: [spec.envVar],
    label: spec.label,
    instructions: spec.instructions,
    gate: options.gate,
  }));

  return gate === null;
}

/**
 * Check one provider's pixel config + access token.
 *
 * @param {Object} context - Handler context
 * @param {Object} spec - { key, label, idLabel, envVar }
 * @returns {Object} - Handler return ({ output } / warned)
 */
async function ensurePixelToken(context, spec) {
  const { brandConfig } = context;
  const pixelId = brandConfig.analytics?.providers?.[spec.key]?.id;

  if (!pixelId) {
    console.log(chalk.dim(`      ⊘ ${spec.label} not configured (analytics.providers.${spec.key}.id)`));
    return {};
  }

  console.log(`      ${chalk.green('✓')} ${spec.idLabel}: ${chalk.cyan(pixelId)}`);

  const alreadySet = Boolean(process.env[spec.envVar]);
  if (!await acquirePixelToken(context, spec)) {
    return { status: 'warned', output: { [spec.key]: { pixelId, tokenConfigured: false } } };
  }

  if (alreadySet) {
    console.log(`      ${chalk.green('✓')} Access token configured (${chalk.cyan(spec.envVar)})`);
  }

  return { output: { [spec.key]: { pixelId, tokenConfigured: true } } };
}

module.exports = { acquirePixelToken, ensurePixelToken };
