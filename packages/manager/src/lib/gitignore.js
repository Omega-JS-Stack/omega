/**
 * Shared gitignore ensure — the secrets store, the environment env files, run
 * output, and the run logs never get committed. Used by the workspace service
 * (brand roots) and runCompany (the company root, which no service pass touches).
 *
 * The scaffold writes every entry into a NEW brand's .gitignore; this heals
 * every root that predates an entry, on its next manage run (#197: `logs/`;
 * [#586](https://github.com/Omega-JS-Stack/omega/issues/586): `.env.*`).
 */

const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const IGNORE_ENTRY = '.omega/';

// Every entry a root's .gitignore must carry: the aliases that already satisfy
// it, and the comment introducing a freshly added one (matching the scaffold's).
const ENTRIES = [
  {
    entry: IGNORE_ENTRY,
    aliases: ['.omega', '.omega/'],
    comment: '# Omega manager state (durable IDs + per-run output)',
  },
  {
    entry: 'logs/',
    aliases: ['logs', 'logs/'],
    comment: '# Run logs (truncated on every launch — never committed)',
  },
  {
    // `.env` itself is the scaffold's, and every brand already carries it; this
    // is the environment OVERLAY half (#586), which is just as much a secret
    entry: '.env.*',
    aliases: ['.env.*', '.env*'],
    comment: '# Secrets — the environment overlays beside .env',
  },
];

/**
 * Ensure `.omega/`, `logs/` and `.env.*` are listed in {rootDir}/.gitignore.
 * Idempotent — only the missing entries get appended, each under its own comment.
 *
 * @param {string} rootDir - Directory whose .gitignore gets the entries
 * @returns {'present'|'added'}
 */
function ensureOmegaIgnored(rootDir) {
  const gitignorePath = join(rootDir, '.gitignore');
  const existing = jetpack.read(gitignorePath) || '';

  const lines = existing.split('\n').map((line) => line.trim());
  const missing = ENTRIES.filter(({ aliases }) => !lines.some((line) => aliases.includes(line)));

  if (missing.length === 0) {
    return 'present';
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = missing.map(({ entry, comment }) => `\n${comment}\n${entry}\n`).join('');
  jetpack.write(gitignorePath, existing + separator + block);

  return 'added';
}

module.exports = { ensureOmegaIgnored, IGNORE_ENTRY };
