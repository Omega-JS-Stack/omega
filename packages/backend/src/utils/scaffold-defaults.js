// @omega.js/backend's defaults scaffolding — applies the framework's defaults tree
// (src/defaults/ → dist/defaults/ at runtime) to the consumer project root via
// the shared devkit engine. Exported standalone (rather than living inside the
// setup command) so the framework self-test can exercise the REAL file map
// against a temp dir — mirrors BXM's exported scaffoldDefaults.

const path = require('path');
const { applyDefaults } = require('@omega.js/devkit/defaults-engine');

// minimatch FILE_MAP (last-match-wins). @omega.js/backend's contract:
//   - everything copies on first scaffold only (consumer files are never clobbered)
//   - AGENTS.md / .gitignore live-sync their Default section on every run via
//     the marker-section merge (the Custom section is the consumer's,
//     preserved verbatim). Both live at the TARGET ROOT.
//   - the target-root .env is NOT scaffolded ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
//     the brand root's .env is the one file humans and the manager edit, a
//     target .env is an optional per-key override a HUMAN writes, and the
//     machine's env file is the composed dist/.env. No machine writes a
//     target .env, so the template is skipped.
// Patterns match the RAW defaults-tree path (before the `_.` strip), so the
// mergeLines rules name `_.gitignore`, not its output.
const FILE_MAP = {
  '**/*': { overwrite: false },
  // The socket-free static test lane (#567). It lands under `_`-prefixed dirs —
  // the framework's test discovery skips those, so the static suites never run
  // inside the emulator lane — but the defaults ENGINE reads a leading-`_`
  // directory as an archive dir and skips it, so the tree ships them unprefixed
  // and they are re-destinationed here.
  'test/helpers/**': { overwrite: false, path: () => 'test/_helpers' },
  'test/unit/**': { overwrite: false, path: () => 'test/_unit' },
  // The agent-docs chain (#63): AGENTS.md carries the content (marker-merged
  // like .gitignore), CLAUDE.md is the one-line `@AGENTS.md` pointer — copied when
  // missing by the `**/*` rule above, never clobbered.
  'AGENTS.md': { mergeLines: true },
  '_.gitignore': { mergeLines: true },
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
  // ROOT is the one doc home — per-target AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/
  // never scaffold, and existing framework-owned-only copies are swept (retire
  // rules; consumer content is never destroyed). Standalone projects keep them.
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
