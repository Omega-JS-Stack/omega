/**
 * Ensure the brand .env carries every key OMEGA generates for itself — the
 * env schema's `generated` entries (@omega.js/config, #581) — the manage-time
 * half of the mint the onboard scaffold does for a fresh brand (#569). A brand
 * onboarded before a key existed gains it here instead of discovering the hole
 * at the first send.
 *
 * Presence is judged on the RESOLVED value (`process.env`, which manage
 * already layered shell > brand .env > company .env), so a company-managed
 * brand never shadows its company's value with a fresh one. A minted value
 * is published into `process.env` too, so the same run's disperse composes it
 * into targets/backend/.env — the key is live one manage after the gap, not
 * two. Values are never printed: the run says WHICH key it minted, never what.
 */
const chalk = require('chalk').default;

const { generatedEnvKeys } = require('@omega.js/config');
const { writeEnvValue } = require('../../../lib/env-secret.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async (context) => {
  const { brandRoot, options = {} } = context;

  const minted = [];
  const planned = [];
  const present = [];

  for (const [name, generate] of Object.entries(generatedEnvKeys())) {
    if (process.env[name]) {
      present.push(name);
      continue;
    }

    if (options.dryRun) {
      dryRunPlan(`mint ${name} into the brand .env`);
      planned.push(name);
      continue;
    }

    const value = generate();
    writeEnvValue(brandRoot, name, value);
    process.env[name] = value;
    minted.push(name);
  }

  if (minted.length > 0) {
    console.log(`      ${chalk.green('✓')} minted ${chalk.cyan(minted.join(', '))} into the brand .env`);
  }
  if (present.length > 0) {
    console.log(`      ${chalk.green('✓')} generated keys (${present.length} present)`);
  }

  return { output: { envKeys: { minted, planned, present } } };
};
