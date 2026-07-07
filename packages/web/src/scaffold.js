/**
 * @omegajs/web's defaults scaffolding — applies the framework's scaffold tree
 * (scaffold/ in the package) to the consumer project root via the shared
 * devkit engine. Exported standalone (BEM/BXM pattern) so the framework
 * test suite can exercise the REAL file map against a temp dir.
 *
 * UJM-setup semantics preserved, minus what the new architecture deletes:
 *   - NO page copying — default pages are virtual templates served from the
 *     package (the whole ~60-page default set works with zero files in src/)
 *   - NO Gemfile / _config.yml / Ruby anywhere
 *   - marker-section merges keep .gitignore/.env/CLAUDE.md live-synced while
 *     the consumer's Custom section survives verbatim
 */
const path = require('node:path');
const { applyDefaults } = require('@omegajs/devkit/defaults-engine');
const { PATHS } = require('./paths.js');

// The Node major scaffolded into .nvmrc and the CI workflow (monorepo standard).
const NODE_VERSION = '24';

// minimatch FILE_MAP (last-match-wins). Patterns match the RAW scaffold-tree
// path (before the `_.` strip), so the mergeLines rules name `_.gitignore`
// and `_.env`, not their outputs.
const FILE_MAP = {
  '**/*': { overwrite: false },
  'CLAUDE.md': { mergeLines: true },
  '_.gitignore': { mergeLines: true },
  '_.env': { mergeLines: true },
  // JSON5 defaults-merge: consumer values win, new framework keys are added
  'config/omega.json5': { merge: true },
  // Ruby-free CI: regenerated every setup so workflow fixes roll out
  '.github/workflows/build.yml': { overwrite: true, template: { versions: { node: NODE_VERSION } } },
  '.nvmrc': { overwrite: true, template: { versions: { node: NODE_VERSION } } },
};

/**
 * Scaffold @omegajs/web's defaults into a consumer project.
 * @param {object} options
 * @param {string} options.outputDir - consumer project root
 * @param {string} [options.defaultsDir] - override the scaffold tree root (tests)
 * @param {object} [options.logger] - `{ log, warn, error }` passed to the engine
 * @returns {{ written: string[], merged: string[], skipped: string[] }}
 */
function scaffoldDefaults(options) {
  options = options || {};

  return applyDefaults({
    defaultsDir: options.defaultsDir || PATHS.scaffold,
    outputDir: options.outputDir,
    fileMap: FILE_MAP,
    logger: options.logger,
  });
}

module.exports = { scaffoldDefaults, FILE_MAP, NODE_VERSION };
