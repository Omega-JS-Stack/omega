// @omega.js/backend's defaults scaffolding — applies the framework's defaults tree
// (src/defaults/ → dist/defaults/ at runtime) to the consumer project root via
// the shared devkit engine. Exported standalone (rather than living inside the
// setup command) so the framework self-test can exercise the REAL file map
// against a temp dir — mirrors BXM's exported scaffoldDefaults.

const path = require('path');
const { applyDefaults, renderTemplate } = require('@omega.js/devkit/defaults-engine');
const { composeTargetWorkflows, renderInstallFirewall } = require('@omega.js/devkit/ci-workflows');
const { renderSecretsBlock, renderEnvFileKeys } = require('@omega.js/config/env-delivery');

// The framework's own manifest: its pinned Cloud Functions runtime is the Node
// the deploy workflow runs on, the same one `engines.node` carries into the
// staged manifest, so the runner can never deploy from a different major.
const frameworkPackage = require('../../package.json');

const WORKFLOW = '.github/workflows/deploy.yml';

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

  // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the BRAND
  // ROOT is the one doc home — per-target AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/
  // never scaffold, and existing framework-owned-only copies are swept (retire
  // rules; consumer content is never destroyed). Standalone projects keep them.
  const fileMap = { ...FILE_MAP };
  const { resolveSeedMode } = require('@omega.js/config');
  const seed = resolveSeedMode(options.outputDir);
  const defaultsDir = options.defaultsDir || path.resolve(__dirname, '../defaults');

  // The deploy workflow's env block and .env writer are GENERATED from the env
  // schema (#627, #872): one `KEY: ${{ secrets.KEY }}` line per key delivered
  // to backend, and the JSON list of the names its runtime reads, which the
  // workflow's node writer serializes out of the runner env. Both are
  // re-rendered on every verb, so a key added to the schema reaches CI without
  // anyone editing a workflow.
  fileMap[WORKFLOW] = {
    ...fileMap[WORKFLOW],
    template: {
      versions: { node: String(parseInt(frameworkPackage.omega.functionsRuntime, 10)) },
      githubSecrets: renderSecretsBlock('backend', { indent: '  ' }),
      envFileKeys: renderEnvFileKeys('backend'),
    },
  };

  if (!seed.standalone) {
    fileMap['AGENTS.md'] = { retire: true };
    fileMap['CLAUDE.md'] = { retire: true };
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
    // The firewall step is devkit's, rendered wherever a workflow is WRITTEN
    // (#872): the brand lane gets it inside composeWorkflow below, a STANDALONE
    // target here. The action and its pin live in ONE place.
    transform: (contents) => renderInstallFirewall(contents),
    logger: options.logger,
  });

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
