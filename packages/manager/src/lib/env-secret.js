/**
 * Brand .env writeback — persist a secret so every future run (and CI)
 * sees the same value. Used for machine-generated secrets that only have
 * to stay stable (CSC_KEY_PASSWORD, ACCOUNT_PASSWORD_SEED) and for
 * interactively-entered ones (the payment processor-setup flows). Replaces
 * the variable's line in place when it already exists, appends otherwise —
 * then applies the canonical ordering (env-order.js, cp137), the same way
 * writeConfigValues applies the omega.json5 canonical order on every
 * writeback. The order pass is a polish step: if it declines (exotic file
 * structure), the plain replace/append result is written unchanged.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { applyEnvOrder } = require('./env-order.js');

/**
 * Write NAME="value" into the brand .env (replace-or-append).
 *
 * @param {string} brandRoot - Brand-monorepo root (its .env is the target)
 * @param {string} name - Env var name, e.g. 'CSC_KEY_PASSWORD'
 * @param {string} value - Value to persist
 */
function writeEnvValue(brandRoot, name, value) {
  const envPath = join(brandRoot, '.env');
  const line = `${name}="${value}"`;
  const pattern = new RegExp(`^${name}\\s*=.*$`, 'm');

  let envContent = jetpack.exists(envPath) ? jetpack.read(envPath) : '';
  if (pattern.test(envContent)) {
    envContent = envContent.replace(pattern, line);
  } else {
    // Terminate any existing content with exactly one newline, then append
    envContent = envContent === '' ? '' : envContent.replace(/\n*$/, '\n');
    envContent += `${line}\n`;
  }
  jetpack.write(envPath, applyEnvOrder(envContent).content);
}

module.exports = { writeEnvValue };
