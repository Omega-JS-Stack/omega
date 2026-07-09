/**
 * Ensure .omega/ is gitignored at the brand root — durable state and run
 * output never get committed. Idempotent: checks for an existing entry
 * before appending. The shared ensure also covers company roots (runCompany).
 */
const chalk = require('chalk').default;

const { ensureOmegaIgnored, IGNORE_ENTRY } = require('../../../lib/gitignore.js');

module.exports = async ({ brandRoot }) => {
  if (ensureOmegaIgnored(brandRoot) === 'present') {
    console.log(`      ${chalk.green('✓')} .gitignore has ${IGNORE_ENTRY}`);
    return null;
  }

  console.log(`      ${chalk.green('✓')} Added ${IGNORE_ENTRY} to .gitignore`);
  return { output: { gitignore: 'added' } };
};
