/**
 * @omega.js/web's defaults scaffolding — applies the framework's scaffold tree
 * (scaffold/ in the package) to the consumer project root via the shared
 * devkit engine. Exported standalone (@omega.js/backend/BXM pattern) so the framework
 * test suite can exercise the REAL file map against a temp dir.
 *
 * UJM-setup semantics preserved, minus what the new architecture deletes:
 *   - NO page copying — default pages are virtual templates served from the
 *     package (the whole ~60-page default set works with zero files in src/)
 *   - NO Gemfile / _config.yml / Ruby anywhere
 *   - marker-section merges keep .gitignore/.env/AGENTS.md live-synced while
 *     the consumer's Custom section survives verbatim
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { applyDefaults } = require('@omega.js/devkit/defaults-engine');
const { resolveSeedMode, renderBrandAppSeed, resolveConfigPath } = require('@omega.js/config');
const { collectEnvSecrets, renderSecretsBlock } = require('./github-secrets.js');
const { PATHS } = require('./paths.js');

// The Node major scaffolded into .nvmrc and the CI workflow (monorepo standard).
const NODE_VERSION = '24';

// minimatch FILE_MAP (last-match-wins). Patterns match the RAW scaffold-tree
// path (before the `_.` strip), so the mergeLines rules name `_.gitignore`
// and `_.env`, not their outputs.
const FILE_MAP = {
  '**/*': { overwrite: false },
  // The agent-docs chain (#63): AGENTS.md carries the content (marker-merged
  // like .env), CLAUDE.md is the one-line `@AGENTS.md` pointer — copied when
  // missing by the `**/*` rule above, never clobbered.
  'AGENTS.md': { mergeLines: true },
  '_.gitignore': { mergeLines: true },
  '_.env': { mergeLines: true },
  // JSON5 defaults-merge: consumer values win, new framework keys are added
  'config/omega.json5': { merge: true },
  // Ruby-free CI: regenerated every setup so workflow fixes roll out
  '.github/workflows/build.yml': { overwrite: true, template: { versions: { node: NODE_VERSION } } },
  '.nvmrc': { overwrite: true, template: { versions: { node: NODE_VERSION } } },
};

/**
 * Scaffold @omega.js/web's defaults into a consumer project.
 * @param {object} options
 * @param {string} options.outputDir - consumer project root
 * @param {string} [options.defaultsDir] - override the scaffold tree root (tests)
 * @param {object} [options.logger] - `{ log, warn, error }` passed to the engine
 * @returns {{ written: string[], merged: string[], skipped: string[] }}
 */
function scaffoldDefaults(options) {
  options = options || {};

  // Layer-aware seed (dogfood friction #1): inside a brand monorepo the app
  // config is TARGETS-ONLY — the full template (placeholder brand id/name)
  // would shadow the brand root's config, and the merge rule would keep
  // re-adding template keys under it. Standalone consumers keep the full
  // template + JSON5 merge.
  const fileMap = { ...FILE_MAP };
  const logger = options.logger || console;

  // The CI workflow's secrets env block is GENERATED per brand (#189): the
  // keys of the app's resolved .env cascade, rendered into the template's
  // `{{ githubSecrets }}` token. `overwrite: true` means every setup
  // re-renders it, so the block heals like every other scaffolded default.
  const workflow = FILE_MAP['.github/workflows/build.yml'];
  fileMap['.github/workflows/build.yml'] = {
    ...workflow,
    template: {
      ...workflow.template,
      githubSecrets: renderSecretsBlock(Object.keys(collectEnvSecrets({ appDir: options.outputDir }))),
    },
  };
  if (!resolveSeedMode(options.outputDir).standalone) {
    // Say which mode applied ([#95](https://github.com/Omega-JS-Stack/omega/issues/95)):
    // the branch below rewrites what setup scaffolds, and a silent branch made
    // a missing config template and a missing AGENTS.md read as a bug.
    logger.log('brand monorepo detected — targets-only config seed; the agent docs live at the brand root');
    if (!resolveConfigPath(options.outputDir)) {
      jetpack.write(path.join(options.outputDir, 'config', 'omega.json5'), renderBrandAppSeed('web'));
    }
    fileMap['config/omega.json5'] = { overwrite: false };
    // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the
    // BRAND ROOT is the one doc home — the per-app AGENTS.md/CLAUDE.md never
    // scaffold, and existing framework-owned-only copies are swept (retire
    // rules; consumer content is never destroyed). Standalone apps keep them.
    fileMap['AGENTS.md'] = { retire: true };
    fileMap['CLAUDE.md'] = { retire: true };
  } else {
    logger.log('standalone app — full config template scaffolded; the per-app agent docs land here');
  }

  return applyDefaults({
    defaultsDir: options.defaultsDir || PATHS.scaffold,
    outputDir: options.outputDir,
    fileMap,
    logger: options.logger,
  });
}

module.exports = { scaffoldDefaults, FILE_MAP, NODE_VERSION };
