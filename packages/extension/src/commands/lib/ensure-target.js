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
 *   firefox id        the derived AMO add-on id, pinned into the brand config
 *                     when the brand declares none (#893)
 *   node version      a WARNING when the shell is older than the framework's pin
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
const { assertScaffoldable } = require('@omega.js/devkit/scaffold-guard');
const { listingId, deriveFirefoxId, listingConfigPath } = require('../../lib/listings.js');

const logger = Manager.logger('ensure-target');
const package = Manager.getPackage('main');

/**
 * Sync the consumer manifest: the omega verb scripts, the npm-private latch
 * (extensions are never published to npm) and the license the store listing
 * declares (#884, seeded only when the manifest states none). Identical content is not a write
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

  // State the license once, when the manifest states none
  // ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)): UNLICENSED is
  // npm's word for closed-source commercial code, and the Firefox lane maps it
  // to AMO's `all-rights-reserved` when it creates the store listing. A brand
  // that authored its own license keeps it, licensing being the brand's call.
  project.license = project.license || 'UNLICENSED';

  // Save the project — npm's own shape, trailing newline included.
  const projectPath = path.join(projectDir, 'package.json');
  const contents = `${JSON.stringify(project, null, 2)}\n`;

  if (jetpack.read(projectPath) === contents) {
    return;
  }

  jetpack.write(projectPath, contents);
  result.changed.push('package.json (scripts + private + license)');
}

/**
 * Pin the Firefox add-on id into the brand config
 * ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)).
 *
 * The id is OURS, not the store's: AMO adopts the packaged manifest's gecko id
 * as the add-on guid, and the package task derives that id from the brand facts
 * when the config declares none. It must stay STABLE after the first upload
 * (and `brand.url` is free to change), so the derived value becomes a declared
 * fact in `config/omega.json5` the first time a verb runs here.
 *
 * Why the SCAFFOLD, and not the deploy precheck: the brand-root fan-out runs
 * every target's ensureTarget BEFORE its one snapshot push
 * ([#901](https://github.com/Omega-JS-Stack/omega/issues/901)) and runs each
 * target's precheck inside its verb, AFTER that push, so a write in the
 * precheck would miss this run's snapshot while a write here rides it. The
 * scaffold also runs before every verb on the laptop, so a first `omega deploy`
 * from the target itself pins the id before the packager or the publish ever
 * reads it. The runner never writes: its checkout is the throwaway mirror.
 */
function pinFirefoxListingId(projectDir, result, log) {
  const { findBrandRoot, hasOmegaConfig, loadConfig, targetNameFromDir, writeConfigValues } = require('@omega.js/config');

  // A project with no config at all (a fresh dir) has no brand facts to derive from.
  if (!hasOmegaConfig(projectDir)) {
    return;
  }

  // Addressed at the TARGET, not the cwd, because the brand-root fan-out calls
  // this in-process from the brand root: same reader Manager.getConfig() is.
  // The ambient environment is the right layer here, unlike a deploy-time read
  // that pins production (#856): the scaffold runs before EVERY verb, and the
  // add-on id is one value across environments, judged and written in the BASE
  // layer so every environment reads the same id.
  // An overlay that declares a different id is a config error; catching that is
  // the validator's job, not this read's.
  const { config } = loadConfig(projectDir, 'extension', { environment: Manager.getEnvironment() });

  // A declared id is the brand's word, and nothing here second-guesses it.
  if (listingId(config, 'firefox')) {
    return;
  }

  const id = deriveFirefoxId(config);

  // Nothing to derive from: the package task is where that fails loudly, as today.
  if (!id) {
    return;
  }

  const configDir = findBrandRoot(projectDir) || projectDir;
  const configPath = listingConfigPath(targetNameFromDir(projectDir) || 'extension', 'firefox');
  const report = writeConfigValues(configDir, { [configPath]: id });

  if (!report.changed) {
    return;
  }

  result.changed.push(path.relative(projectDir, report.path));
  log(`Pinned ${configPath} = ${id} (the Firefox add-on id must stay stable after the first upload)`);
}

/**
 * The framework's pinned runtime is a FLOOR here. The verdict rides `warn`, the
 * way web's and desktop's checks report theirs: a scaffold is the one pass the
 * brand-root deploy fan-out runs in-process on every target, so a shell one
 * minor behind must reach the developer as a warning rather than end the run.
 */
function ensureNodeVersion(log, warn) {
  const installedVersion = version.clean(process.version);
  const requiredVersion = version.clean(package.omega.nodeRuntime);
  const isUpToDate = version.is(installedVersion, '>=', requiredVersion);

  log(`Checking if Node.js is up to date (${logger.format.bold(installedVersion)} >= ${logger.format.bold(requiredVersion)}): ${isUpToDate ? logger.format.green('Yes') : logger.format.red('No')}`);

  if (!isUpToDate) {
    warn(`Node ${installedVersion} is older than the framework's pinned runtime (v${requiredVersion}): run \`nvm use\` before the next build`);
  }
}

/**
 * The framework must BE a dependency of the target: everything below it reads
 * the installed version. A `file:` spec is no finding of its own
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the deploy
 * snapshot packs every locally linked package into the mirror it pushes, so a
 * local install is exactly what the deploy is built for.
 */
function checkLocality(projectDir) {
  const project = readProject(projectDir);
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in dependencies or devDependencies.`);
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

  // A workspace ROOT is not a target either — and unlike the case above, landing
  // there is an accident (a verb run from the wrong cwd), so it fails LOUD (#699).
  assertScaffoldable(projectDir);

  setupScripts(projectDir, result);
  pinFirefoxListingId(projectDir, result, log);
  ensureNodeVersion(log, warn);

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

  checkLocality(projectDir);

  for (const [label, files] of [['Created', result.written], ['Merged', result.merged], ['Synced', result.changed]]) {
    if (files.length > 0) log(`${label} ${files.join(', ')}`);
  }

  return result;
}

module.exports = { ensureTarget, setupScripts };
