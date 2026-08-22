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
const { applyDefaults, renderTemplate } = require('@omega.js/devkit/defaults-engine');
const { composeTargetWorkflows } = require('@omega.js/devkit/ci-workflows');
const { resolveSeedMode } = require('@omega.js/config');
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

  // Layer-aware seed (dogfood friction #1, cp121c): inside a brand monorepo
  // the target carries NO local-layer omega.json5 — the brand file's `targets.*` is
  // the per-target home and that file is the STANDALONE escape hatch only,
  // so the template must not scaffold there (the full template's placeholder
  // brand id/name would shadow the brand root, and the old targets-only seed
  // kept resurrecting a file the target deliberately omits —
  // [#298](https://github.com/Omega-JS-Stack/omega/issues/298)). Standalone
  // consumers keep the full template + JSON5 merge.
  const fileMap = { ...FILE_MAP };
  const logger = options.logger || console;

  // The CI workflow's secrets env block is GENERATED per brand (#189): the
  // keys of the target's resolved .env cascade, rendered into the template's
  // `{{ githubSecrets }}` token. `overwrite: true` means every setup
  // re-renders it, so the block heals like every other scaffolded default.
  const workflow = FILE_MAP['.github/workflows/build.yml'];
  const workflowTokens = {
    ...workflow.template,
    githubSecrets: renderSecretsBlock(Object.keys(collectEnvSecrets({ targetDir: options.outputDir }))),
  };
  fileMap['.github/workflows/build.yml'] = { ...workflow, template: workflowTokens };

  const seed = resolveSeedMode(options.outputDir);
  const defaultsDir = options.defaultsDir || PATHS.scaffold;
  if (!seed.standalone) {
    // Say which mode applied ([#95](https://github.com/Omega-JS-Stack/omega/issues/95)):
    // the branch below rewrites what setup scaffolds, and a silent branch made
    // a missing config template and a missing AGENTS.md read as a bug.
    logger.log('brand monorepo detected: no target-level config seed; the brand root config and the agent docs cover this target');
    fileMap['config/omega.json5'] = { skip: true };
    // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the
    // BRAND ROOT is the one doc home — the per-target AGENTS.md/CLAUDE.md never
    // scaffold, and existing framework-owned-only copies are swept (retire
    // rules; consumer content is never destroyed). Standalone projects keep them.
    fileMap['AGENTS.md'] = { retire: true };
    fileMap['CLAUDE.md'] = { retire: true };
    // CI (#265): GitHub runs workflows from the REPO ROOT only, so a per-target
    // .github/workflows/ in a brand monorepo can never fire. It is composed
    // into the brand root below instead — scoped to this target's path.
    fileMap['.github/**/*'] = { skip: true };
  } else {
    logger.log('standalone project — full config template scaffolded; the per-project agent docs land here');
  }

  const result = applyDefaults({
    defaultsDir,
    outputDir: options.outputDir,
    fileMap,
    logger: options.logger,
  });

  if (!seed.standalone) {
    composeTargetWorkflows({
      sourceDir: path.join(defaultsDir, '.github', 'workflows'),
      targetDir: options.outputDir,
      brandRoot: seed.brandRoot,
      transform: (contents) => renderTemplate(contents, workflowTokens),
      logger,
    });
  }

  return result;
}

module.exports = { scaffoldDefaults, FILE_MAP, NODE_VERSION };
