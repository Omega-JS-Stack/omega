/**
 * ensure-target: the LOCAL, idempotent scaffold every verb runs first, so every
 * verb heals the tree on the way past. It guarantees:
 *
 *   node version         a WARNING when the shell is older than the standard
 *   scaffold defaults    the framework tree (marker merges, the AGENTS.md
 *                        builder, the omega.json5 seed, the CI workflow)
 *   package.json         the omega verb scripts + the engines.node floor
 *
 * Copy-if-missing, marker-merge or write-if-changed: nothing is clobbered, and
 * nothing needing the network runs here (secrets publish in deploy-precheck.js).
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { scaffoldDefaults, NODE_VERSION } = require('../../scaffold.js');
const { assertScaffoldable } = require('@omega.js/devkit/scaffold-guard');
const { projectScripts } = require('@omega.js/devkit/verb-scripts');

const frameworkPackage = require('../../../package.json');

// package.json scripts every consumer gets: the verb scripts the verb table
// derives for this framework (`start` included), with any manifest
// `projectScripts` merged over them. The manager's workspace walk derives the
// same set to heal a fresh target before any verb has run.
const PROJECT_SCRIPTS = projectScripts(frameworkPackage);

/**
 * Sync the consumer manifest's omega scripts, engines floor + license (#884,
 * seeded only when the manifest states none). A manifest that
 * already says all of it is not rewritten (#590 parity: identical content is
 * not a write).
 *
 * @param {string} projectDir - The target root.
 * @param {{ changed: string[] }} result - Collector.
 */
function scaffoldPackageJson(projectDir, result) {
  const manifestPath = path.join(projectDir, 'package.json');
  const exists = jetpack.exists(manifestPath);
  const manifest = exists
    ? JSON.parse(jetpack.read(manifestPath))
    : { name: path.basename(projectDir), version: '1.0.0', private: true };

  const before = JSON.stringify(manifest);
  manifest.scripts = { ...manifest.scripts, ...PROJECT_SCRIPTS };
  manifest.engines = { ...manifest.engines, node: `>=${NODE_VERSION}` };
  // The license every OMEGA target states when it states none of its own
  // ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)): UNLICENSED is
  // npm's word for closed-source commercial code. A brand's own license stands.
  manifest.license = manifest.license || 'UNLICENSED';

  if (JSON.stringify(manifest) === before && exists) return;

  jetpack.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  result.changed.push('package.json (scripts + engines.node + license)');
}

/**
 * Make the target whole — idempotent, offline, and quiet when there is
 * nothing to do.
 *
 * @param {object} [options]
 * @param {string} [options.projectDir] - The target root (default: cwd).
 * @param {function} [options.log] - Line logger (silent by default).
 * @param {function} [options.warn] - Warning logger (silent by default).
 * @returns {{ written: string[], merged: string[], changed: string[] }}
 *   Target-relative paths per outcome — empty on a no-op run.
 */
function ensureTarget(options) {
  options = options || {};
  const projectDir = options.projectDir || process.cwd();
  const log = options.log || (() => {});
  const warn = options.warn || (() => {});
  const result = { written: [], merged: [], changed: [] };

  // The framework's own tree is not a consumer target. Running the framework's
  // suite from packages/web puts the framework at the cwd, and a verb that
  // scaffolds unconditionally would scatter the consumer defaults through the
  // package. Refuse, quietly: this is a normal state, not a broken one.
  if (jetpack.read(path.join(projectDir, 'package.json'), 'json')?.name === frameworkPackage.name) {
    return result;
  }

  // A workspace ROOT is not a target either — and unlike the case above, landing
  // there is an accident (a verb run from the wrong cwd), so it fails LOUD (#699).
  assertScaffoldable(projectDir);

  // ---- Node version check (warn only — the .nvmrc scaffolded below is the pin)
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < Number(NODE_VERSION)) {
    warn(`Node ${process.versions.node} is older than the framework standard (v${NODE_VERSION}) — update .nvmrc/nvm`);
  }

  // ---- Scaffold defaults (copy-if-missing + marker merges)
  const scaffolded = scaffoldDefaults({
    outputDir: projectDir,
    logger: { log: () => {}, warn, error: warn },
  });
  result.written.push(...scaffolded.written);
  result.merged.push(...scaffolded.merged);

  // ---- Sync package.json scripts
  scaffoldPackageJson(projectDir, result);

  for (const [label, files] of [['Created', result.written], ['Merged', result.merged], ['Synced', result.changed]]) {
    if (files.length > 0) log(`${label} ${files.join(', ')}`);
  }

  return result;
}

module.exports = { ensureTarget, PROJECT_SCRIPTS };
