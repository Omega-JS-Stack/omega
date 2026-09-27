/**
 * Ensure .omega/ and logs/ are gitignored at the brand root — the secrets
 * store and run output never get committed. Idempotent: checks for existing entries
 * before appending.
 */
const chalk = require('chalk').default;

const { ensureOmegaIgnored } = require('../../../lib/gitignore.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async ({ brandRoot, options = {} }) => {
  if (ensureOmegaIgnored(brandRoot, { dryRun: options.dryRun }) === 'present') {
    console.log(`      ${chalk.green('✓')} .gitignore has the omega entries`);
    return null;
  }

  if (options.dryRun) {
    return dryRunPlan('add the missing omega entries to .gitignore', { output: { gitignore: 'planned' } });
  }

  console.log(`      ${chalk.green('✓')} Added missing omega entries to .gitignore`);
  return { output: { gitignore: 'added' } };
};
