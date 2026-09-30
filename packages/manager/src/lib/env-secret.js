/**
 * Brand .env writeback: persist a secret so every future run (and CI) sees the
 * same value. The key's first line or placeholder takes the new line and every
 * later assignment drops (appended when the file has none), then
 * converges through the marker engine (env-order.js); when the converge
 * declines, the plain replace/append result is written.
 *
 * mintGeneratedKey is the ONE mint for the env schema's `generated:` keys: the
 * workspace env-keys op and the setup contract (lib/service-input.js) both call
 * it, so a brand cannot tell which one got there first.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { generatedEnvKeys, assertEnvReadsBack, envLine } = require('@omega.js/config');
const { setEnvLines } = require('@omega.js/devkit/env-lines');
const { convergeEnv } = require('./env-order.js');

/**
 * Write NAME="value" into the brand .env (replace-or-append, then converge).
 *
 * @param {string} brandRoot - Brand-monorepo root (its .env is the target)
 * @param {string} name - Env var name, e.g. 'CSC_KEY_PASSWORD'
 * @param {string} value - Value to persist
 */
function writeEnvValue(brandRoot, name, value) {
  const envPath = join(brandRoot, '.env');
  // envLine is the serializer SSOT (@omega.js/config); setEnvLines is the key-line grammar
  const envContent = setEnvLines(jetpack.exists(envPath) ? jetpack.read(envPath) : '', { [name]: envLine(name, value) });
  const converged = convergeEnv(envContent).content;
  // One line cannot show it all: a trailing backslash can run into the next
  assertEnvReadsBack(converged, { [name]: value });
  jetpack.write(envPath, converged);
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
