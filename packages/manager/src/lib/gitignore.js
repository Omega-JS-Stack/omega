/**
 * The brand root and company root .gitignore: the one home of each file's
 * framework lines, written through devkit's marker engine. The Default section
 * is these lines, rewritten on every manage (a retired line leaves); the
 * Custom section is the consumer's, kept verbatim. The scaffolds write the
 * marked file, the workspace service heals it.
 */

const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const { mergeLineBasedFiles, hasSectionMarkers, DEFAULT_MARKER, CUSTOM_MARKER } = require('@omega.js/devkit/merge-line-files');

const BRAND_LINES = [
  '# Dependencies',
  'node_modules/',
  '',
  '# Build output',
  'dist/',
  '',
  '# OMEGA manager state (derived data, never committed)',
  '.omega/',
  '',
  '# Run logs (truncated on every launch, never committed)',
  'logs/',
  '',
  '# Secrets',
  '.env',
  '.env.*',
  '',
  '# OS',
  '.DS_Store',
];

// The company tree's own copy of the unshareable half, so a root-file edit or
// a copy of the tree can never commit it.
const COMPANY_LINES = [
  '# Secrets: the shared .env and its per-environment overlays',
  '.env',
  '.env.*',
  '',
  '# The SHARED SIGNING TREE: .omega/certificates/apple/ holds Apple private key',
  '# material (.p8, .p12, CSR keys). It never goes in git; move it between',
  '# machines out of band.',
  '.omega/',
];

function renderMarked(lines) {
  return [DEFAULT_MARKER, ...lines, '', CUSTOM_MARKER, ''].join('\n');
}

/**
 * The brand root .gitignore a fresh brand gets and every manage heals to.
 * @returns {string}
 */
function renderBrandGitignore() {
  return renderMarked(BRAND_LINES);
}

/**
 * The company tree's .gitignore `omega company init` writes and every manage heals to.
 * @returns {string}
 */
function renderCompanyGitignore() {
  return renderMarked(COMPANY_LINES);
}

/**
 * Ensure {rootDir}/.gitignore is the marked file for this template: created when
 * missing, a marked file's Default section healed with its Custom section kept,
 * a file from before the markers converged once with its own lines under
 * Custom. Idempotent.
 *
 * @param {string} rootDir - Directory whose .gitignore is ensured
 * @param {string} template - The marked template (renderBrandGitignore / renderCompanyGitignore)
 * @param {{ dryRun?: boolean }} [options] - dryRun: the same verdict, nothing written
 * @returns {'present'|'created'|'healed'|'converged'}
 */
function ensureGitignore(rootDir, template, { dryRun = false } = {}) {
  const gitignorePath = join(rootDir, '.gitignore');
  const existing = jetpack.read(gitignorePath);

  if (existing === undefined) {
    if (!dryRun) jetpack.write(gitignorePath, template);
    return 'created';
  }

  const next = mergeLineBasedFiles(existing, template, '.gitignore');
  if (next === existing) {
    return 'present';
  }
  if (!dryRun) jetpack.write(gitignorePath, next);
  return hasSectionMarkers(existing) ? 'healed' : 'converged';
}

module.exports = { ensureGitignore, renderBrandGitignore, renderCompanyGitignore };
