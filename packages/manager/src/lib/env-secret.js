/**
 * Brand .env writeback — persist a generated secret so every future run
 * (and CI) sees the same value. Used for machine-generated secrets that
 * only have to stay stable, never be memorable: CSC_KEY_PASSWORD
 * (certificates) and ACCOUNT_PASSWORD_SEED (account). Replaces the
 * variable's line in place when it already exists, appends otherwise.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

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
  jetpack.write(envPath, envContent);
}

module.exports = { writeEnvValue };
