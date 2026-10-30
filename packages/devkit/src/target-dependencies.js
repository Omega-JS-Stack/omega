/**
 * The dependency checks the retired `omega setup` carried
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)), split by what
 * they need:
 *
 *   ensurePeerDependencies  the target cannot build without them, LOCAL half:
 *                           every framework with peers (backend, desktop,
 *                           extension) runs it from its `ensureTarget` on every verb
 *   updateManager           asks the npm registry whether the framework itself
 *                           is stale — NETWORK half, deploy-precheck runs it
 *
 * They share the same installer and the same version-check line, so they share
 * a file rather than a copy each — and every framework shares THIS file rather
 * than a drift-identical copy per package. What differs per framework is data,
 * not logic: the peer-dep install-location map and the framework's own
 * `safeInstall`, both passed in.
 */

const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const chalk = require('chalk').default;
const { getLatestVersion } = require('./npm-registry.js');

/**
 * The consumer manifest at `projectDir`, its two dependency sections normalized.
 *
 * @param {string} projectDir - The target root.
 * @returns {object} The manifest, with `dependencies`/`devDependencies` always objects.
 */
function readProject(projectDir) {
  const project = jetpack.read(path.join(projectDir, 'package.json'), 'json') || {};
  project.dependencies = project.dependencies || {};
  project.devDependencies = project.devDependencies || {};
  return project;
}

function logVersionCheck(log, name, installedVersion, latestVersion, isUpToDate) {
  // A `file:` spec is the local-link era's answer — always current by definition.
  if (installedVersion && installedVersion.startsWith('file:')) {
    isUpToDate = true;
  }

  const installedLabel = installedVersion || '(none)';
  const latestLabel = latestVersion || '(unknown)';
  const status = isUpToDate ? chalk.green('Yes') : chalk.red('No');

  log(`Checking if ${name} is up to date (${chalk.bold(installedLabel)} >= ${chalk.bold(latestLabel)}): ${status}`);
}

/**
 * Whether a dependency spec names a version at all.
 *
 * @param {string} [spec] - A package.json dependency spec.
 * @returns {boolean} False when absent, `latest`, `*` or a `file:` link.
 */
function isVersionSpec(spec) {
  return !!spec && spec !== 'latest' && spec !== '*' && !spec.startsWith('file:');
}

function install({ projectDir, project, log, safeInstall, pkg, ver, location, ignoreScripts }) {
  ver = ver === 'latest' || !ver ? 'latest' : version.clean(ver);

  const command = `npm install ${pkg}@${ver} ${location || '--save'}${ignoreScripts ? ' --ignore-scripts' : ''}`;
  log(`Installing: ${command}`);

  // The target, never the process cwd: a brand-root fan-out scaffolds targets in-process.
  return safeInstall(command, { log: true, config: { cwd: projectDir } })
    .then(() => {
      const projectUpdated = readProject(projectDir);
      project.dependencies = projectUpdated.dependencies;
      project.devDependencies = projectUpdated.devDependencies;
      log(`Installed: ${pkg} ${ver}`);
    });
}

/**
 * Install any peer dependency the target is missing or behind on. A satisfied
 * target installs nothing, which is what makes this safe on every verb. The
 * install skips lifecycle scripts, and a MAJOR gap installs nothing: it prints
 * the by-hand command, so no verb moves a brand across a major silently.
 *
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.package - The framework manifest (its peerDependencies).
 * @param {function} input.log - Line logger.
 * @param {function} input.warn - Warning logger (the major-gap refusal).
 * @param {Object<string, string>} [input.dependencyMap] - Per-dep install location (`'dev'` = --save-dev).
 * @param {function} input.safeInstall - The framework's install runner.
 */
async function ensurePeerDependencies({ projectDir, package: frameworkPackage, log, warn, dependencyMap, safeInstall }) {
  const project = readProject(projectDir);
  const requiredPeerDependencies = frameworkPackage.peerDependencies || {};
  const map = dependencyMap || {};

  for (const [dependency, rawVer] of Object.entries(requiredPeerDependencies)) {
    const installedSpec = project.dependencies[dependency] || project.devDependencies[dependency];
    const projectDependencyVersion = version.clean(installedSpec);
    const location = map[dependency] === 'dev' ? '--save-dev' : '';
    const isUpToDate = version.is(projectDependencyVersion, '>=', rawVer);

    const ver = version.clean(rawVer);

    logVersionCheck(log, dependency, projectDependencyVersion, ver, isUpToDate);

    if (isUpToDate) {
      continue;
    }

    // A spec that is no version (`latest`, `*`, a `file:` link), installed or
    // required, cleans to 0.0.0, which is no gap to measure: it installs as it
    // always did.
    if (isVersionSpec(installedSpec) && isVersionSpec(rawVer) && version.levelDifference(projectDependencyVersion, ver) === 'major') {
      warn(`${dependency} is a major version behind (${projectDependencyVersion} < ${ver}), so nothing was installed. Move it by hand: npm install ${dependency}@${ver}${location ? ` ${location}` : ''}`);
      continue;
    }

    await install({ projectDir, project, log, safeInstall, pkg: dependency, ver, location, ignoreScripts: true });
  }
}

/**
 * Is the installed framework the latest published one? Hits the npm registry,
 * so it rides `omega deploy`'s network precheck, never a build.
 *
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.package - The framework manifest.
 * @param {function} input.log - Line logger.
 * @param {function} input.error - Error logger.
 * @param {function} input.safeInstall - The framework's install runner.
 */
async function updateManager({ projectDir, package: frameworkPackage, log, error, safeInstall }) {
  const project = readProject(projectDir);

  // Either section counts (friction #12) — the framework is a build-time dep,
  // but web/backend accept dependencies too; one rule everywhere.
  const installedVersion = project.devDependencies[frameworkPackage.name] || project.dependencies[frameworkPackage.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${frameworkPackage.name} found in dependencies or devDependencies.`);
  }

  const latestVersion = (await getLatestVersion(frameworkPackage.name)) || '0.0.0';

  const isUpToDate = version.is(installedVersion, '>=', latestVersion);
  const levelDifference = version.levelDifference(installedVersion, latestVersion);

  logVersionCheck(log, frameworkPackage.name, installedVersion, latestVersion, isUpToDate);

  if (installedVersion.startsWith('file:')) {
    return;
  }

  if (!isUpToDate) {
    if (levelDifference === 'major' && installedVersion !== 'latest') {
      return error(`Major version difference detected. Please update to ${latestVersion} manually.`);
    }
    await install({ projectDir, project, log, safeInstall, pkg: frameworkPackage.name, ver: latestVersion });
  }
}

module.exports = { readProject, ensurePeerDependencies, updateManager, logVersionCheck };
