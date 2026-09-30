// @omega.js/backend's defaults scaffolding — applies the framework's defaults tree
// (src/defaults/ → dist/defaults/ at runtime) to the consumer project root via
// the shared devkit engine. Exported standalone (rather than living inside the
// setup command) so the framework self-test can exercise the REAL file map
// against a temp dir, the same shape as @omega.js/extension's scaffoldDefaults.

const path = require('path');
const { applyDefaults, renderTemplate } = require('@omega.js/devkit/defaults-engine');
const { scaffoldAgentsMd } = require('@omega.js/devkit/agents-md');
const { composeTargetWorkflows, renderInstallFirewall, renderInstallWorkspace } = require('@omega.js/devkit/ci-workflows');
const { renderSecretsBlock, renderEnvFileKeys } = require('@omega.js/config/env-delivery');

// The framework's own manifest: its pinned Cloud Functions runtime is the Node
// the deploy workflow runs on, the same one `engines.node` carries into the
// staged manifest, so the runner can never deploy from a different major.
const frameworkPackage = require('../../package.json');

const WORKFLOW = '.github/workflows/deploy.yml';

// Last-match-wins, matched on the RAW defaults-tree path (`_.gitignore`, before
// the `_.` strip). Everything copies on first scaffold only, .gitignore
// marker-merges, and no target .env is scaffolded: the brand root's is the one
// edited file (docs/backend/index.md, The env cascade).
const FILE_MAP = {
  '**/*': { overwrite: false },
  '_.gitignore': { mergeLines: true },
  // Scaffolded docs are generated output: the framework rewrites the Default
  // section from this source on every verb, the project's notes live under Custom.
  'test/README.md': { mergeLines: true },
  // The deploy workflow is FRAMEWORK-owned: re-rendered on every verb so the
  // generated env block tracks the schema and the pinned node tracks the
  // framework ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
  [WORKFLOW]: { overwrite: true },
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

  // In a brand the BRAND ROOT is the one doc home: per-target CHANGELOG.md and
  // docs/ never scaffold, and framework-owned copies are swept (consumer
  // content is kept). Standalone projects keep them.
  const fileMap = { ...FILE_MAP };
  const { composeTargetEnv, resolveSeedMode } = require('@omega.js/config');
  const seed = resolveSeedMode(options.outputDir);
  const defaultsDir = options.defaultsDir || path.resolve(__dirname, '../defaults');

  // The deploy workflow's env block and .env writer are GENERATED from the env
  // schema AND this brand's COMPOSED production values (#627, #872, #835,
  // #876): one `KEY: ${{ secrets.KEY }}` line per key delivered to backend, and
  // the JSON list of the names its runtime reads, which the workflow's node
  // writer serializes out of the runner env. Both come out of the ONE delivery
  // primitive reading ONE set, so what the runner is handed and what its .env
  // writer names cannot disagree. The composed half is what names the keys the
  // schema cannot: the CONNECTIONS_* providers this brand configured, and the
  // consumer's own keys. Both are re-rendered on every verb, so a key added to
  // the schema or to .env.production reaches CI without anyone editing a
  // workflow. NAMES only ever reach the file; no value is rendered anywhere.
  const { values: composed } = composeTargetEnv({ targetDir: options.outputDir, target: 'backend', environment: 'production' });

  fileMap[WORKFLOW] = {
    ...fileMap[WORKFLOW],
    template: {
      versions: { node: String(parseInt(frameworkPackage.omega.functionsRuntime, 10)) },
      githubSecrets: renderSecretsBlock('backend', { indent: '  ', values: composed }),
      envFileKeys: renderEnvFileKeys('backend', { values: composed }),
    },
  };

  if (!seed.standalone) {
    fileMap['CHANGELOG.md'] = { retire: true };
    fileMap['docs/**/*'] = { retire: true };
    // CI (#265): GitHub runs workflows from the REPO ROOT only, so a per-target
    // .github/workflows/ in a brand monorepo can never fire. It is composed
    // into the brand root below instead, scoped to this target's path.
    fileMap['.github/**/*'] = { skip: true };
  }

  const result = applyDefaults({
    defaultsDir,
    outputDir: options.outputDir,
    fileMap,
    // The firewall step and the workspace flag are devkit's, rendered wherever
    // a workflow is WRITTEN (#872, #898): the brand lane gets both inside
    // composeWorkflow below, a STANDALONE target here. The action, its pin and
    // the flag live in ONE place. A standalone target is its own repo root and
    // declares no workspaces, so the flag renders to nothing here.
    transform: (contents) => renderInstallWorkspace(renderInstallFirewall(contents)),
    logger: options.logger,
  });

  // The project-root AGENTS.md, through devkit's one builder.
  scaffoldAgentsMd({ outputDir: options.outputDir, standalone: seed.standalone, result, logger: options.logger });

  if (!seed.standalone) {
    composeTargetWorkflows({
      sourceDir: path.join(defaultsDir, '.github', 'workflows'),
      targetDir: options.outputDir,
      brandRoot: seed.brandRoot,
      transform: (contents) => renderTemplate(contents, fileMap[WORKFLOW].template),
      logger: options.logger || console,
    });
  }

  return result;
}

module.exports = { scaffoldDefaults, FILE_MAP };
