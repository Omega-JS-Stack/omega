// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('setup');
const argv = Manager.getArguments();
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const { execute, template, force } = require('node-powertools');
const { safeInstall } = require('../lib/safe-install');
const { getLatestVersion } = require('@omega.js/devkit/npm-registry');
const glob = require('glob').globSync;
const { minimatch } = require('minimatch');

// Load package
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');
const manifest = Manager.getManifest();
const rootPathProject = Manager.getRootPath('project');

// Dependency MAP
const DEPENDENCY_MAP = {
  'gulp': 'dev',
}

module.exports = async function (options) {
  // Fix options
  options = options || {};
  options.checkManager = force(options.checkManager || true, 'boolean');
  options.checkNode = force(options.checkNode || true, 'boolean');
  options.checkPeerDependencies = force(options.checkPeerDependencies || true, 'boolean');
  options.setupScripts = force(options.setupScripts || true, 'boolean');
  options.checkLocality = force(options.checkLocality || true, 'boolean');
  options.scaffold = force(options.scaffold || true, 'boolean');
  options.migrate = options.migrate !== 'false';

  // Log
  logger.log(`Welcome to ${package.name} v${package.version}!`);
  logger.log(`options`, options);

  // Prefix project
  project.dependencies = project.dependencies || {};
  project.devDependencies = project.devDependencies || {};

  try {
    // Log current working directory
    await logCWD();

    // Run migrations
    if (options.migrate) {
      await migrate();
    }

    // Ensure this package is up-to-date
    if (options.checkManager) {
      await updateManager();
    }

    // Ensure proper node version
    if (options.checkNode) {
      await ensureNodeVersion();
    }

    // Run the setup
    if (options.checkPeerDependencies) {
      await ensurePeerDependencies();
    }

    // Setup scripts
    if (options.setupScripts) {
      await setupScripts();
    }

    // Scaffold the consumer interior at setup — the same engine run the
    // build's defaults task performs, so extension consumers get their files
    // when web/desktop consumers do, not at first build (friction #13).
    if (options.scaffold) {
      const { scaffoldDefaults } = require('../gulp/tasks/defaults.js');
      await scaffoldDefaults();
    }

    // Check which locality we are using
    if (options.checkLocality) {
      await checkLocality();
    }
  } catch (e) {
    // Throw error
    throw e;
  }
};

async function logCWD() {
  logger.log('Current working directory:', process.cwd());
  // logger.log('Current working directory 2:', await execute('pwd'));
  // logger.log('Current working directory 3:', await execute('ls -al'));
}

async function updateManager() {
  // Get the latest version — either section counts (friction #12): the
  // framework is a build-time dep, but web/backend accept dependencies too.
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name];
  const latestVersion = (await getLatestVersion(package.name)) || '0.0.0';
  const isUpToDate = version.is(installedVersion, '>=', latestVersion);
  const levelDifference = version.levelDifference(installedVersion, latestVersion);

  // Check if installedVersion is truthy or throw error
  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in dependencies or devDependencies.`);
  }

  // Log
  logVersionCheck(package.name, installedVersion, latestVersion, isUpToDate);

  // Quit if local
  if (installedVersion.startsWith('file:')) {
    return;
  }

  // Check if we need to update
  if (!isUpToDate) {
    // Quit if major version difference
    if (levelDifference === 'major' && installedVersion !== 'latest') {
      return logger.error(`Major version difference detected. Please update to ${latestVersion} manually.`);
    }

    // Install the latest version
    await install(package.name, latestVersion);
  }
}

async function ensureNodeVersion() {
  const installedVersion = version.clean(process.version);
  const requiredVersion = version.clean(package.omega.nodeRuntime);
  const isUpToDate = version.is(installedVersion, '>=', requiredVersion);

  // Log
  logVersionCheck('Node.js', installedVersion, requiredVersion, isUpToDate);

  // Check if we need to update
  if (!isUpToDate) {
    throw new Error(`Node version is out-of-date. Required version is ${requiredVersion}.`);
  }
}
async function ensurePeerDependencies() {
  const requiredPeerDependencies = package.peerDependencies || {};

  // Loop through and make sure project has AT LEAST the required version
  for (const [dependency, rawVer] of Object.entries(requiredPeerDependencies)) {
    const projectDependencyVersion = version.clean(project?.dependencies?.[dependency] || project?.devDependencies?.[dependency]);
    const location = DEPENDENCY_MAP[dependency] === 'dev' ? '--save-dev' : '';
    const isUpToDate = version.is(projectDependencyVersion, '>=', rawVer);

    // Clean version if needed
    const ver = version.clean(rawVer);

    // Log
    // logger.log('Checking peer dep:', dependency, '-->', projectDependencyVersion, '>=', ver);
    logVersionCheck(dependency, projectDependencyVersion, ver, isUpToDate);

    // Install if not found
    if (
      // Not found
      !projectDependencyVersion
      // Not the right version
      || !isUpToDate
    ) {
      await install(dependency, ver, location);
    }
  }
}

function setupScripts() {
  // Setup the scripts
  project.scripts = project.scripts || {};

  // Setup the scripts
  Object.keys(package.projectScripts).forEach((key) => {
    project.scripts[key] = package.projectScripts[key];
  });

  // Ensure the project is private (extensions should never be published to npm)
  project.private = true;

  // Save the project
  jetpack.write(path.join(process.cwd(), 'package.json'), project);
}

function checkLocality() {
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name];

  // Check if installedVersion is truthy or throw error
  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in dependencies or devDependencies.`);
  }

  // Warn if using local version
  if (installedVersion.startsWith('file:')) {
    logger.warn(`⚠️⚠️⚠️ You are using the local version of ${package.name}. This WILL NOT WORK when published. ⚠️⚠️⚠️`);
  }
}

function install(package, ver, location) {
  // Default to latest
  ver || 'latest';

  // Clean version if needed
  ver = ver === 'latest' ? ver : version.clean(ver);

  // Build the command
  const command = `npm install ${package}@${ver} ${location || '--save'}`;

  // Log
  logger.log('Installing:', command);

  // Execute
  return safeInstall(command)
  .then(async () => {
    // Read new project
    const projectUpdated = jetpack.read(path.join(process.cwd(), 'package.json'), 'json');

    // Log
    logger.log('Installed:', package, ver);

    // Update package object
    project.dependencies = projectUpdated.dependencies || {};
    project.devDependencies = projectUpdated.devDependencies || {};
  });
}

function logVersionCheck(name, installedVersion, latestVersion, isUpToDate) {
  // Quit if local
  if (installedVersion.startsWith('file:')) {
    isUpToDate = true;
  }

  // Log
  logger.log(`Checking if ${name} is up to date (${logger.format.bold(installedVersion)} >= ${logger.format.bold(latestVersion)}): ${isUpToDate ? logger.format.green('Yes') : logger.format.red('No')}`);
}

// Run migrations based on installed version
async function migrate() {
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name] || '0.0.0';

  // Skip if using local version
  if (installedVersion.startsWith('file:')) {
    return;
  }

  // Migrate hooks to nested structure (introduced in 0.0.185)
  if (version.is(installedVersion, '<=', '2.0.0')) {
    await migrateHooksToNestedStructure();
  }
}

// Migrate old hook files to new nested structure
async function migrateHooksToNestedStructure() {
  const hooksDir = path.join(rootPathProject, 'hooks');

  // Map of old file names to new paths
  const migrations = [
    { old: 'build:post.js', new: 'build/post.js' },
    { old: 'build:pre.js', new: 'build/pre.js' },
    { old: 'middleware:request.js', new: 'middleware/request.js' },
  ];

  let migratedCount = 0;

  for (const migration of migrations) {
    const oldPath = path.join(hooksDir, migration.old);
    const newPath = path.join(hooksDir, migration.new);

    // Check if old file exists
    if (!jetpack.exists(oldPath)) {
      continue;
    }

    // Check if new file already exists
    if (jetpack.exists(newPath)) {
      logger.warn(`⚠️  Migrate ${migration.old}: ${migration.new} already exists`);
    }

    // Move the file
    jetpack.move(oldPath, newPath, { overwrite: true });
    logger.log(`✅ Migrated hook: ${migration.old} → ${migration.new}`);
    migratedCount++;
  }

  if (migratedCount > 0) {
    logger.log(`✅ Migrated ${migratedCount} hook file(s) to new nested structure`);
  }
}
