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
 * is published into `process.env` too, so the same run's builds compose it
 * into their targets — the key is live one manage after the gap, not two.
 * Values are never printed: the run says WHICH key it minted, never what.
 *
 * The mint itself is lib/env-secret.js's `mintGeneratedKey` — shared with the
 * setup contract, which mints a single key for a service that reached it
 * before this op ran (#635).
 */
const chalk = require('chalk').default;

const { generatedEnvKeys } = require('@omega.js/config');
const { mintGeneratedKey } = require('../../../lib/env-secret.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async (context) => {
  const { brandRoot, options = {} } = context;

  const minted = [];
  const planned = [];
  const present = [];

  for (const name of Object.keys(generatedEnvKeys())) {
    if (process.env[name]) {
      present.push(name);
      continue;
    }

    if (options.dryRun) {
      dryRunPlan(`mint ${name} into the brand .env`);
      planned.push(name);
      continue;
    }

    // The mint — and its success line — live once, in lib/env-secret.js, so
    // this op and the setup contract report an identical key identically
    mintGeneratedKey(brandRoot, name);
    minted.push(name);
  }

  if (present.length > 0) {
    console.log(`      ${chalk.green('✓')} generated keys (${present.length} present)`);
  }

  return { output: { envKeys: { minted, planned, present } } };
};
