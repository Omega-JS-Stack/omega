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
 * presence check with where-to-get guidance — interactive runs walk the user
 * to the exact page that mints one (the Enter-gated open, house rule: ask
 * permission, never auto-open) and take a paste-in that saves the token to
 * the brand .env (the disperse service composes it into the backend's app
 * .env; the stage step carries it into dist/); leaving it empty keeps the
 * warned guidance.
 */
const chalk = require('chalk').default;
const { input, pressEnterToOpen } = require('@omega.js/devkit/prompt');

const { writeEnvValue } = require('../../../lib/env-secret.js');
const { canPrompt } = require('../../../lib/run-gates.js');

/**
 * Make sure the provider's access token is in the environment, asking for
 * it when the run can prompt. Silent when the token is already set — the
 * caller reports it (the create path stays quiet, the check path prints its
 * ✓ line).
 *
 * @param {Object} context - Handler context
 * @param {Object} spec - { label, envVar, tokenSource, tokenUrl }
 * @returns {Promise<boolean>} - Whether the token is now in process.env
 */
async function acquirePixelToken(context, spec) {
  const { brandRoot, options = {} } = context;

  if (process.env[spec.envVar]) {
    return true;
  }

  console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(spec.envVar)} not set in the brand .env`);
  console.log(`      ${chalk.dim('→')} Get it from ${spec.tokenSource}`);

  if (!canPrompt(options)) {
    return false;
  }

  if (spec.tokenUrl) {
    await pressEnterToOpen(spec.tokenUrl, `the ${spec.label} token page`);
  }

  const value = (await input({ message: `    ${spec.envVar} (leave empty to skip):` })).trim();
  if (!value) {
    return false;
  }

  writeEnvValue(brandRoot, spec.envVar, value);
  process.env[spec.envVar] = value;
  console.log(`      ${chalk.green('✓')} ${spec.envVar} saved to the brand .env`);
  return true;
}

/**
 * Check one provider's pixel config + access token.
 *
 * @param {Object} context - Handler context
 * @param {Object} spec - { key, label, idLabel, envVar, tokenSource, tokenUrl }
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
