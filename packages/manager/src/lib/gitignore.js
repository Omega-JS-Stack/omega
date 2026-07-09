/**
 * Shared .omega/ gitignore ensure — durable state, run output, and company
 * logs never get committed. Used by the workspace service (brand roots) and
 * runCompany (the company root, which no service pass touches).
 */

const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const IGNORE_ENTRY = '.omega/';

/**
 * Ensure `.omega/` is listed in {rootDir}/.gitignore. Idempotent.
 *
 * @param {string} rootDir - Directory whose .gitignore gets the entry
 * @returns {'present'|'added'}
 */
function ensureOmegaIgnored(rootDir) {
  const gitignorePath = join(rootDir, '.gitignore');
  const existing = jetpack.read(gitignorePath) || '';

  const hasEntry = existing
    .split('\n')
    .some((line) => ['.omega', '.omega/'].includes(line.trim()));

  if (hasEntry) {
    return 'present';
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${separator}\n# Omega manager state (durable IDs + per-run output)\n${IGNORE_ENTRY}\n`;
  jetpack.write(gitignorePath, existing + block);

  return 'added';
}

module.exports = { ensureOmegaIgnored, IGNORE_ENTRY };
