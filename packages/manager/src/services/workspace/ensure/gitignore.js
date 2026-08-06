/**
 * Ensure .omega/ and logs/ are gitignored at the brand root — durable state
 * and run output never get committed. Idempotent: checks for existing entries
 * before appending. The shared ensure also covers company roots (runCompany).
 */
const chalk = require('chalk').default;

const { ensureOmegaIgnored } = require('../../../lib/gitignore.js');

module.exports = async ({ brandRoot }) => {
  if (ensureOmegaIgnored(brandRoot) === 'present') {
    console.log(`      ${chalk.green('✓')} .gitignore has the omega entries`);
    return null;
  }

  console.log(`      ${chalk.green('✓')} Added missing omega entries to .gitignore`);
  return { output: { gitignore: 'added' } };
};
