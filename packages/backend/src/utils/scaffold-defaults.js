// BEM's defaults scaffolding — applies the framework's defaults tree
// (src/defaults/ → dist/defaults/ at runtime) to the consumer project root via
// the shared devkit engine. Exported standalone (rather than living inside the
// setup command) so the framework self-test can exercise the REAL file map
// against a temp dir — mirrors BXM's exported scaffoldDefaults.

const path = require('path');
const { applyDefaults } = require('@omegajs/devkit/defaults-engine');

// minimatch FILE_MAP (last-match-wins). BEM's contract:
//   - everything copies on first setup only (consumer files are never clobbered)
//   - CLAUDE.md / .gitignore / functions/.env live-sync their Default section on
//     every setup via the marker-section merge (the Custom section is the
//     consumer's, preserved verbatim)
// Patterns match the RAW defaults-tree path (before the `_.` strip), so the
// mergeLines rules name `_.gitignore` / `functions/_.env`, not their outputs.
const FILE_MAP = {
  '**/*': { overwrite: false },
  'CLAUDE.md': { mergeLines: true },
  '_.gitignore': { mergeLines: true },
  'functions/_.env': { mergeLines: true },
};

/**
 * Scaffold BEM's defaults into a consumer project.
 *
 * @param {object} options
 * @param {string} options.outputDir - Consumer project root (firebaseProjectPath)
 * @param {string} [options.defaultsDir] - Override the defaults tree root (tests)
 * @param {object} [options.logger] - `{ log, warn, error }` passed to the engine
 * @returns {{ written: string[], merged: string[], skipped: string[] }}
 */
function scaffoldDefaults(options) {
  options = options || {};

  return applyDefaults({
    defaultsDir: options.defaultsDir || path.resolve(__dirname, '../defaults'),
    outputDir: options.outputDir,
    fileMap: FILE_MAP,
    logger: options.logger,
  });
}

module.exports = { scaffoldDefaults, FILE_MAP };
