// @omega.js/backend's defaults scaffolding — applies the framework's defaults tree
// (src/defaults/ → dist/defaults/ at runtime) to the consumer project root via
// the shared devkit engine. Exported standalone (rather than living inside the
// setup command) so the framework self-test can exercise the REAL file map
// against a temp dir — mirrors BXM's exported scaffoldDefaults.

const path = require('path');
const { applyDefaults } = require('@omega.js/devkit/defaults-engine');

// minimatch FILE_MAP (last-match-wins). @omega.js/backend's contract:
//   - everything copies on first setup only (consumer files are never clobbered)
//   - AGENTS.md / .gitignore / .env live-sync their Default section on every
//     setup via the marker-section merge (the Custom section is the
//     consumer's, preserved verbatim). All three live at the APP ROOT — the
//     .env moved up from functions/ with the src/dist pillar (functions/ is
//     staged output; the stage step copies the app .env into it).
// Patterns match the RAW defaults-tree path (before the `_.` strip), so the
// mergeLines rules name `_.gitignore` / `_.env`, not their outputs.
const FILE_MAP = {
  '**/*': { overwrite: false },
  // The agent-docs chain (#63): AGENTS.md carries the content (marker-merged
  // like .env), CLAUDE.md is the one-line `@AGENTS.md` pointer — copied when
  // missing by the `**/*` rule above, never clobbered.
  'AGENTS.md': { mergeLines: true },
  '_.gitignore': { mergeLines: true },
  '_.env': { mergeLines: true },
};

/**
 * Scaffold @omega.js/backend's defaults into a consumer project.
 *
 * @param {object} options
 * @param {string} options.outputDir - Consumer project root (firebaseProjectPath)
 * @param {string} [options.defaultsDir] - Override the defaults tree root (tests)
 * @param {object} [options.logger] - `{ log, warn, error }` passed to the engine
 * @returns {{ written: string[], merged: string[], skipped: string[] }}
 */
function scaffoldDefaults(options) {
  options = options || {};

  // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the BRAND
  // ROOT is the one doc home — per-app AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/
  // never scaffold, and existing framework-owned-only copies are swept (retire
  // rules; consumer content is never destroyed). Standalone apps keep them.
  const fileMap = { ...FILE_MAP };
  const { resolveSeedMode } = require('@omega.js/config');
  if (!resolveSeedMode(options.outputDir).standalone) {
    fileMap['AGENTS.md'] = { retire: true };
    fileMap['CLAUDE.md'] = { retire: true };
    fileMap['CHANGELOG.md'] = { retire: true };
    fileMap['docs/**/*'] = { retire: true };
  }

  return applyDefaults({
    defaultsDir: options.defaultsDir || path.resolve(__dirname, '../defaults'),
    outputDir: options.outputDir,
    fileMap,
    logger: options.logger,
  });
}

module.exports = { scaffoldDefaults, FILE_MAP };
