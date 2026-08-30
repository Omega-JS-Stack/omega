/**
 * ensure-target — the LOCAL, idempotent scaffold every verb runs
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * `omega setup` used to own this half and nothing ran it for you, so a target
 * drifted until someone remembered the command per target. It is retired: the
 * "write it if missing" steps live here and dev/build/test/deploy each call it
 * first, so every verb heals the tree on the way past.
 *
 * What it guarantees:
 *
 *   node version         a WARNING when the shell is older than the standard
 *   scaffold defaults    the framework tree (marker merges for
 *                        .gitignore/.env/AGENTS.md, omega.json5 seed, CI workflow)
 *   package.json         the omega verb scripts + the engines.node floor
 *
 * Everything here is copy-if-missing, marker-merge or write-if-changed: a
 * consumer file is never clobbered, and a run that changes nothing writes
 * nothing. Anything that needs the network is NOT here — the secret
 * publication `omega setup` also carried is a deploy precheck (deploy-precheck.js).
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { scaffoldDefaults, NODE_VERSION } = require('../../scaffold.js');

const frameworkPackage = require('../../../package.json');

// package.json scripts every consumer gets. Declared in the framework
// manifest's `projectScripts` (sibling parity: backend/desktop/extension all
// declare theirs there, and the manager's workspace walk reads it to heal a
// fresh target before any verb has run). No `setup` entry: the verbs run
// ensureTarget themselves (#675).
const PROJECT_SCRIPTS = frameworkPackage.projectScripts;

/**
 * Sync the consumer manifest's omega scripts + engines floor. A manifest that
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

  if (JSON.stringify(manifest) === before && exists) return;

  jetpack.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  result.changed.push('package.json (scripts + engines.node)');
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

  // ---- Node version check (warn only — the .nvmrc scaffolded below is the pin)
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < Number(NODE_VERSION)) {
    warn(`Node ${process.versions.node} is older than the framework standard (v${NODE_VERSION}) — update .nvmrc/nvm`);
  }

  // ---- Scaffold defaults (copy-if-missing + marker merges)
  const scaffolded = scaffoldDefaults({
    outputDir: projectDir,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
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
