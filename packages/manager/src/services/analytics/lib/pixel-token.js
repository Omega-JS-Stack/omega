/**
 * Shared pixel-token check for the meta-pixel/tiktok-pixel operations.
 *
 * The pixel ID is public config (`analytics.providers.{provider}.id` — it
 * ships in the frontend); the conversions/events access token is a secret
 * and lives in the brand .env under the exact name @omegajs/backend reads.
 * There's no practical validation API for either token, so this is a
 * presence check with where-to-get guidance — interactive runs offer a
 * paste-in that saves the token to the brand .env (the disperse service
 * then carries it into the backend's functions/.env); leaving it empty
 * keeps the warned guidance.
 */
const chalk = require('chalk').default;
const { input, isInteractive } = require('@omegajs/devkit/prompt');

const { writeEnvValue } = require('../../../lib/env-secret.js');

/**
 * Check one provider's pixel config + access token.
 *
 * @param {Object} context - Handler context
 * @param {Object} spec - { key, label, idLabel, envVar, tokenSource }
 * @returns {Object} - Handler return ({ output } / warned)
 */
async function ensurePixelToken(context, spec) {
  const { brandConfig, brandRoot, options = {} } = context;
  const pixelId = brandConfig.analytics?.providers?.[spec.key]?.id;

  if (!pixelId) {
    console.log(chalk.dim(`      ⊘ ${spec.label} not configured (analytics.providers.${spec.key}.id)`));
    return {};
  }

  console.log(`      ${chalk.green('✓')} ${spec.idLabel}: ${chalk.cyan(pixelId)}`);

  if (process.env[spec.envVar]) {
    console.log(`      ${chalk.green('✓')} Access token configured (${chalk.cyan(spec.envVar)})`);
    return { output: { [spec.key]: { pixelId, tokenConfigured: true } } };
  }

  console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(spec.envVar)} not set in the brand .env`);
  console.log(`      ${chalk.dim('→')} Get it from ${spec.tokenSource}`);

  if (isInteractive() && !options.dryRun) {
    const value = (await input({ message: `    ${spec.envVar} (leave empty to skip):` })).trim();
    if (value) {
      writeEnvValue(brandRoot, spec.envVar, value);
      process.env[spec.envVar] = value;
      console.log(`      ${chalk.green('✓')} ${spec.envVar} saved to the brand .env`);
      return { output: { [spec.key]: { pixelId, tokenConfigured: true } } };
    }
  }

  return { status: 'warned', output: { [spec.key]: { pixelId, tokenConfigured: false } } };
}

module.exports = { ensurePixelToken };
