/**
 * ensure-target — the LOCAL, idempotent scaffold every verb runs
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * `omega setup` used to own this half and nothing ran it for you, so a target
 * drifted until someone remembered the command per target. It is retired: the
 * "write it if missing" steps live here, the gulp `defaults` task calls it
 * first (so `npm start` and every gulp build heal the tree), and the non-gulp
 * verbs — `omega test`, `omega deploy` — call it themselves.
 *
 * What it guarantees, in this order:
 *
 *   package.json      the omega verb scripts + the npm-private latch — pure
 *                     manifest edits, so they land before anything that throws
 *   node version      FATAL when the shell is older than the framework's pin
 *   peer dependencies installed when missing or behind (a satisfied target
 *                     installs nothing)
 *   defaults tree     the consumer interior, via the gulp defaults task's
 *                     scaffoldDefaults — the ONE scaffold implementation
 *   locality          a WARNING when the framework is a `file:` link
 *
 * What needs the network is NOT here: the framework freshness check is an
 * `omega deploy` precheck (deploy-precheck.js), and the one-time hook-layout
 * migration is its own command (`omega migrate`).
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const Manager = new (require('../../build.js'));
const { ensurePeerDependencies, readProject } = require('./dependencies.js');

const logger = Manager.logger('ensure-target');
const package = Manager.getPackage('main');

/**
 * Sync the consumer manifest: the omega verb scripts and the npm-private latch
 * (extensions are never published to npm). Identical content is not a write
 * (#572) — it matters more since #675, because this runs on EVERY verb.
 */
function setupScripts(projectDir, result) {
  projectDir = projectDir || Manager.getRootPath('project');
  result = result || { changed: [] };

  const project = readProject(projectDir);

  // Setup the scripts
  project.scripts = project.scripts || {};

  Object.keys(package.projectScripts).forEach((key) => {
    project.scripts[key] = package.projectScripts[key];
  });

  // Ensure the project is private (extensions should never be published to npm)
  project.private = true;

  // Save the project — npm's own shape, trailing newline included.
  const projectPath = path.join(projectDir, 'package.json');
  const contents = `${JSON.stringify(project, null, 2)}\n`;

  if (jetpack.read(projectPath) === contents) {
    return;
  }

  jetpack.write(projectPath, contents);
  result.changed.push('package.json (scripts + private)');
}

/** The framework's pinned runtime is a FLOOR here — an older shell is fatal. */
function ensureNodeVersion(log) {
  const installedVersion = version.clean(process.version);
  const requiredVersion = version.clean(package.omega.nodeRuntime);
  const isUpToDate = version.is(installedVersion, '>=', requiredVersion);

  log(`Checking if Node.js is up to date (${logger.format.bold(installedVersion)} >= ${logger.format.bold(requiredVersion)}): ${isUpToDate ? logger.format.green('Yes') : logger.format.red('No')}`);

  if (!isUpToDate) {
    throw new Error(`Node version is out-of-date. Required version is ${requiredVersion}.`);
  }
}

/** Warn when the framework is a `file:` link — that install never publishes. */
function checkLocality(projectDir, warn) {
  const project = readProject(projectDir);
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in dependencies or devDependencies.`);
  }

  if (installedVersion.startsWith('file:')) {
    warn(`⚠️⚠️⚠️ You are using the local version of ${package.name}. This WILL NOT WORK when published. ⚠️⚠️⚠️`);
  }
}

/**
 * Make the target whole — idempotent, offline, and quiet when there is
 * nothing to do.
 *
 * @param {object} [options]
 * @param {string} [options.projectDir] - The target root (default: cwd).
 * @param {function} [options.log] - Line logger (silent by default).
 * @param {function} [options.warn] - Warning logger (silent by default).
 * @returns {Promise<{ written: string[], merged: string[], changed: string[] }>}
 *   Target-relative paths per outcome — empty on a no-op run.
 */
async function ensureTarget(options) {
  options = options || {};
  const projectDir = options.projectDir || Manager.getRootPath('project');
  const log = options.log || (() => {});
  const warn = options.warn || (() => {});
  const result = { written: [], merged: [], changed: [] };

  // The framework's own tree is not a consumer target. Running the framework's
  // suite from packages/extension puts the framework at the cwd, and a verb
  // that scaffolds unconditionally would install its own peer deps into itself
  // and scatter the consumer defaults through the package. Refuse, quietly:
  // this is a normal state, not a broken one.
  if (readProject(projectDir).name === package.name) {
    return result;
  }

  setupScripts(projectDir, result);
  ensureNodeVersion(log);

  await ensurePeerDependencies({ projectDir, package, log });

  // The consumer interior — the SAME engine run the build's defaults task
  // performs (friction #13). Required lazily: that task requires this module
  // back, and only one of the two can win at load time.
  const { scaffoldDefaults } = require('../../gulp/tasks/defaults.js');
  const applied = scaffoldDefaults({ outputDir: projectDir });
  if (applied) {
    result.written.push(...applied.written);
    result.merged.push(...applied.merged);
  }

  checkLocality(projectDir, warn);

  for (const [label, files] of [['Created', result.written], ['Merged', result.merged], ['Synced', result.changed]]) {
    if (files.length > 0) log(`${label} ${files.join(', ')}`);
  }

  return result;
}

module.exports = { ensureTarget, setupScripts };
