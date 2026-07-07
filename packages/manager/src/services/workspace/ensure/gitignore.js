/**
 * Ensure .omega/ is gitignored at the brand root — durable state and run
 * output never get committed. Idempotent: checks for an existing entry
 * before appending.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const IGNORE_ENTRY = '.omega/';

module.exports = async ({ brandRoot }) => {
  const gitignorePath = join(brandRoot, '.gitignore');
  const existing = jetpack.read(gitignorePath) || '';

  const hasEntry = existing
    .split('\n')
    .some((line) => ['.omega', '.omega/'].includes(line.trim()));

  if (hasEntry) {
    console.log(`      ${chalk.green('✓')} .gitignore has ${IGNORE_ENTRY}`);
    return null;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${separator}\n# Omega manager state (durable IDs + per-run output)\n${IGNORE_ENTRY}\n`;
  jetpack.write(gitignorePath, existing + block);

  console.log(`      ${chalk.green('✓')} Added ${IGNORE_ENTRY} to .gitignore`);
  return { output: { gitignore: 'added' } };
};
