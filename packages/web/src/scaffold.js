/**
 * @omega.js/web's defaults scaffolding: applies the package's scaffold/ tree to
 * the consumer root through devkit's shared engine. Exported standalone so the
 * framework suite exercises the REAL file map against a temp dir.
 *
 * No page copying (default pages are virtual templates served from the
 * package) and no Ruby; .gitignore and .gitattributes are marker-merged, and
 * AGENTS.md comes from devkit's one builder.
 */
const path = require('node:path');
const { applyDefaults, renderTemplate } = require('@omega.js/devkit/defaults-engine');
const { scaffoldAgentsMd } = require('@omega.js/devkit/agents-md');
const { composeTargetWorkflows, renderInstallFirewall, renderInstallWorkspace } = require('@omega.js/devkit/ci-workflows');
const { composeTargetEnv, resolveSeedMode } = require('@omega.js/config');
const { renderSecretsBlock } = require('@omega.js/config/env-delivery');
const { PATHS } = require('./paths.js');

// The Node major scaffolded into .nvmrc and the CI workflow (monorepo standard).
const NODE_VERSION = '24';

// Last-match-wins, matched on the RAW scaffold-tree path (`_.gitignore`, before
// the `_.` strip). No target .env is scaffolded: the brand root's is the one
// edited file (docs/web/index.md).
const FILE_MAP = {
  '**/*': { overwrite: false },
  '_.gitignore': { mergeLines: true },
  '_.gitattributes': { mergeLines: true },
  // JSON5 defaults-merge: consumer values win, new framework keys are added
  'config/omega.json5': { merge: true },
  // Scaffolded docs are generated output: the framework rewrites the Default
  // section from this source on every verb, the project's notes live under Custom.
  'test/README.md': { mergeLines: true },
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

  // The CI workflow's secrets env block is GENERATED (#189, #627): the env
  // schema's web delivery set, rendered into the template's
  // `{{ githubSecrets }}` token by @omega.js/config's ONE renderer — the same
  // list `omega deploy` publishes as repo secrets. `overwrite: true` means
  // every setup re-renders it, so the block heals like every other scaffolded
  // default.
  // The composed half (#835): the brand's PRODUCTION values name the keys the
  // schema cannot, which on web is the consumer's own `.env` lines. NAMES only
  // ever reach the workflow file; no value is rendered anywhere.
  const { values: composed } = composeTargetEnv({ targetDir: options.outputDir, target: 'web', environment: 'production' });
  const workflow = FILE_MAP['.github/workflows/build.yml'];
  const workflowTokens = {
    ...workflow.template,
    githubSecrets: renderSecretsBlock('web', { indent: '  ', values: composed }),
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
    // The firewall step and the workspace flag are devkit's, rendered wherever
    // a workflow is WRITTEN ([#872](https://github.com/Omega-JS-Stack/omega/issues/872),
    // [#898](https://github.com/Omega-JS-Stack/omega/issues/898)): the brand
    // lane gets both inside composeWorkflow below, and a STANDALONE target gets
    // them here, on the copy the scaffold engine writes. The action, its pin
    // and the flag live in ONE place, so no template restates them. A
    // standalone target is its own repo root and declares no workspaces, so the
    // flag renders to nothing here.
    transform: (contents) => renderInstallWorkspace(renderInstallFirewall(contents)),
    logger: options.logger,
  });

  // The project-root AGENTS.md, through devkit's one builder.
  scaffoldAgentsMd({ outputDir: options.outputDir, standalone: seed.standalone, result, logger });

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
