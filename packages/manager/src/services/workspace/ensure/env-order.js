/**
 * Ensure the brand .env (and the company .env when the brand is
 * company-managed) is in the canonical order — groups, comments, and
 * placeholders from the env-order SSOT, hand comments travelling with
 * their keys, duplicates collapsed to the dotenv winner. A converged file
 * rewrites nothing; a file the reorderer can't parse (multi-line values,
 * export forms) is left untouched with a note, never a failure.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { applyEnvOrder } = require('../../../lib/env-order.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async (context) => {
  const { brandRoot, companyRoot, brandConfig, options = {} } = context;

  const roots = [
    { label: 'brand', root: brandRoot, isBrand: true },
    ...(companyRoot ? [{ label: 'company', root: companyRoot, isBrand: false }] : []),
  ];

  const summary = {};
  for (const { label, root, isBrand } of roots) {
    const envPath = join(root, '.env');
    if (!jetpack.exists(envPath)) {
      console.log(`      ${chalk.dim(`⊘ no ${label} .env yet`)}`);
      summary[label] = 'missing';
      continue;
    }

    const result = applyEnvOrder(jetpack.read(envPath), {
      // Only the brand file gets a default header minted (we know its name);
      // an existing header always wins
      defaultHeader: isBrand
        ? [`# ${brandConfig.brand.name} — brand secrets (gitignored; loaded before every omega-manager run).`]
        : [],
    });

    if (result.skipped) {
      console.log(`      ${chalk.dim(`⊘ ${label} .env left as-is (${result.skipped})`)}`);
      summary[label] = 'skipped';
      continue;
    }
    if (!result.changed) {
      console.log(`      ${chalk.green('✓')} ${label} .env order (current)`);
      summary[label] = 'current';
      continue;
    }
    if (options.dryRun) {
      dryRunPlan(`reorder the ${label} .env into canonical groups`);
      summary[label] = 'planned';
      continue;
    }

    jetpack.write(envPath, result.content);
    const dupNote = result.duplicatesCollapsed > 0
      ? chalk.dim(` (${result.duplicatesCollapsed} duplicate line${result.duplicatesCollapsed === 1 ? '' : 's'} collapsed, last value kept)`)
      : '';
    console.log(`      ${chalk.green('✓')} ${label} .env reordered${dupNote}`);
    summary[label] = 'reordered';
  }

  return { output: { envOrder: summary } };
};
