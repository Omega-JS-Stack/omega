/**
 * Brand .env writeback — persist a secret so every future run (and CI)
 * sees the same value. Used for machine-generated secrets that only have
 * to stay stable (CSC_KEY_PASSWORD, ACCOUNT_PASSWORD_SEED) and for
 * interactively-entered ones (the payment provider-setup flows). Replaces
 * the variable's line in place when it already exists, appends otherwise —
 * then applies the canonical ordering (env-order.js, cp137), the same way
 * writeConfigValues applies the omega.json5 canonical order on every
 * writeback. The order pass is a polish step: if it declines (exotic file
 * structure), the plain replace/append result is written unchanged.
 *
 * mintGeneratedKey is the ONE mint for the keys OMEGA generates for itself
 * (the env schema's `generated:` set): the workspace service's env-keys op
 * does it for the whole set up front, the setup contract (lib/service-input.js)
 * does it for a single key a service reached first — same write, same export,
 * same success line, so a brand cannot tell which one got there first.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { generatedEnvKeys } = require('@omega.js/config');
const { applyEnvOrder } = require('./env-order.js');
const { envLine } = require('../services/disperse/write/env.js');

/**
 * Write NAME="value" into the brand .env (replace-or-append).
 *
 * @param {string} brandRoot - Brand-monorepo root (its .env is the target)
 * @param {string} name - Env var name, e.g. 'CSC_KEY_PASSWORD'
 * @param {string} value - Value to persist
 */
function writeEnvValue(brandRoot, name, value) {
  const envPath = join(brandRoot, '.env');
  // envLine escapes \ " and newlines (the disperse .env writer's serializer — the SSOT);
  // the replacer FUNCTION keeps $& / $1 in a secret from being expanded by String.replace
  const line = envLine(name, value);
  const pattern = new RegExp(`^${name}\\s*=.*$`, 'm');

  let envContent = jetpack.exists(envPath) ? jetpack.read(envPath) : '';
  if (pattern.test(envContent)) {
    envContent = envContent.replace(pattern, () => line);
  } else {
    // Terminate any existing content with exactly one newline, then append
    envContent = envContent === '' ? '' : envContent.replace(/\n*$/, '\n');
    envContent += `${line}\n`;
  }
  jetpack.write(envPath, applyEnvOrder(envContent).content);
}

/**
 * Mint one of OMEGA's own generated keys into the brand .env and into THIS
 * process's env, so the same run that minted it can use it. Values are never
 * printed — the line names the key only.
 *
 * @param {string} brandRoot - Brand-monorepo root (its .env is the target)
 * @param {string} name - An env-schema `generated:` key, e.g. 'OMEGA_WEBHOOK_KEY'
 * @param {object} [options]
 * @param {string} [options.indent] - Leading spaces for the success line, so a
 *   service-level caller and an operation-level one both sit at their own depth
 * @returns {string} The minted value
 */
function mintGeneratedKey(brandRoot, name, options = {}) {
  const generate = generatedEnvKeys()[name];
  if (!generate) {
    // Programmer error: only the env schema says what OMEGA can mint, so a
    // name that is not in that set has no generator and never will
    throw new Error(`${name} is not a generated env key — nothing can mint it`);
  }

  const value = generate();
  writeEnvValue(brandRoot, name, value);
  process.env[name] = value;
  console.log(`${options.indent ?? '      '}${chalk.green('✓')} ${name} minted into the brand .env`);

  return value;
}

module.exports = { writeEnvValue, mintGeneratedKey };
