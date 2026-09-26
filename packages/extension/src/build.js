// The build-time module: one plain object of functions every gulp task, verb
// and consumer hook reads (`const build = require('@omega.js/extension/build')`).
// No class and no `new`, the shape @omega.js/web's and @omega.js/desktop's
// build modules share.

// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const fs = require('fs');
const JSON5 = require('json5');
const { parseArgv } = require('@omega.js/devkit/argv');
const { spawn } = require('child_process');
const { force } = require('node-powertools');
const { setEnvironment, buildLaneEnvironment } = require('@omega.js/config/environment');
const { getEnvironment, isDevelopment, isProduction, isTesting, getVersion } = require('./utils/mode-helpers.js');

// Logger: a named build logger
function logger(name) {
  return new (require('./lib/logger'))(name);
}

// argv: the gulp lane's own parse. `--debug` is value-less; `--browser
// chrome,firefox` carries its value by the parse's own rule.
function getArguments() {
  const options = parseArgv(process.argv.slice(2), { booleans: ['debug'] });

  // Fix
  // browser can be: true (all), false (none), or a string like 'chrome' or 'chrome,firefox'
  options.browser = options.browser === undefined ? true : options.browser;
  options.debug = force(options.debug === undefined ? false : options.debug, 'boolean');

  // Return
  return options;
}

// The notifly argv for a build error. Build messages routinely carry apostrophes
// and parentheses, so the message is a spawn ARG, never interpolated into a shell
// string, which mangled it and killed the notification (#104).
function getBuildErrorNotificationArgs(plugin, message) {
  return [
    '--title', `Build Error: ${plugin}`,
    '--message', message,
    '--timeout', '3',
    '--sound', 'Sosumi',
  ];
}

// notifly is an optional local nicety, so a MISSING BINARY is one friendly note,
// never the raw `spawn notifly ENOENT` dump that used to land after a suite (#123).
// Every other spawn failure keeps the logged-not-thrown error path from #104.
function reportNotificationFailure(error) {
  const log = logger('build-error');

  if (error && error.code === 'ENOENT') {
    return log.warn('notifly not installed, skipping desktop notification');
  }

  return log.error('Failed to send notification', error);
}

// Report build errors with notification
function reportBuildError(error, callback) {
  const log = logger('build-error');

  // Send notification using notifly
  const errorMessage = error.message || error.toString() || 'Unknown error';
  const errorPlugin = error.plugin || 'Build';

  spawn('notifly', getBuildErrorNotificationArgs(errorPlugin, errorMessage), { shell: false, stdio: 'ignore' })
    .on('error', (e) => reportNotificationFailure(e));

  // Log the error
  log.error(`[${errorPlugin}] ${errorMessage}`);

  // If callback provided, call it with error
  if (callback) {
    return callback(error);
  }

  // Otherwise return a function that calls the callback with error
  return (cb) => cb ? cb(error) : error;
}

// isBuildMode: checks if the build mode is enabled
function isBuildMode() {
  return process.env.OMEGA_BUILD_MODE === 'true';
}

// getMode: the build's own verdict, in the shape every OMEGA framework's
// OMEGA_BUILD_JSON wrapper records it under `mode`
// ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)).
function getMode() {
  return {
    build:   isBuildMode(),
    publish: process.env.OMEGA_IS_PUBLISH === 'true',
    environment: getEnvironment(),
  };
}

// actLikeProduction - determines if we should act like production mode
function actLikeProduction() {
  return Boolean(isBuildMode() || process.env.OMEGA_AUDIT_FORCE === 'true');
}

// The environment is the ONE module's (@omega.js/config's environment.js,
// [#817](https://github.com/Omega-JS-Stack/omega/issues/817)), re-exported
// from utils/mode-helpers.js beside getVersion(), exactly as @omega.js/desktop
// and @omega.js/web reach it. It reads ONE input and never guesses.
//
// THIS FILE IS THE BUILD LANE'S ONE SETTER, and it runs at load, before any
// gulp task, verb or getConfig() asks. Two rules, no sniffing:
//   1. OMEGA_BUILD_MODE is the lane saying it is producing a PRODUCTION
//      artifact (`omega build` sets it). It WINS over an inherited variable, so
//      a production build spawned from a test run still bakes production.
//   2. Otherwise a lane that already named one keeps it (the test command names
//      `testing`), and a bare dev boot is `development`.
// The word set here is baked into every bundle as `config.environment`, which
// is what an extension context (no process.env) answers from.
setEnvironment(buildLaneEnvironment(isBuildMode()));

// getManifest: requires and parses config.yml
function getManifest() {
  return JSON5.parse(jetpack.read('src/manifest.json') || '{}');
}

// getConfig: the consumer's RESOLVED config/omega.json5 via @omega.js/config:
// shared sections at the top level, targets.extension overlaid onto them (brand
// walk-up applies in brand monorepos). Secrets never live in the file; the loader
// hard-fails on secret-shaped keys.
function getConfig() {
  const { hasOmegaConfig, loadConfig, formatErrors } = require('@omega.js/config');

  // WHICH environment overlay composes
  // ([#856](https://github.com/Omega-JS-Stack/omega/issues/856)): a build bakes
  // a PRODUCTION artifact, so it names production rather than asking the
  // machine, which answers `development` in a terminal. That decision is made
  // ONCE, at the top of this file, and lands in the one input (#817) every
  // other read in the process answers from, so the overlay that composes and
  // the environment the bundles bake can never be two different words. Same
  // rule, same shape, in @omega.js/desktop's getConfig.
  const environment = getEnvironment();

  // No config at all (fresh dir, non-consumer cwd) → empty shape; callers
  // optional-chain and the defaults task scaffolds the real file on setup.
  const cwd = process.cwd();
  if (!hasOmegaConfig(cwd)) {
    return {};
  }

  const { config, errors } = loadConfig(cwd, 'extension', { environment });

  // Validation findings are FATAL at build time, the same contract as the web
  // build's loadSiteData ([#426](https://github.com/Omega-JS-Stack/omega/issues/426)).
  // A retired key reads as nothing at all, so a build that only warned shipped
  // a bundle missing whatever lived under it and still exited 0. Thrown on
  // EVERY call, never warn-once: tasks call this at require time, and a
  // once-per-process flag left calls 2..n silently building on the bad config.
  if (errors.length) {
    throw new Error(`[@omega.js/extension] config/omega.json5 is invalid:\n${formatErrors(errors)}`);
  }

  return config;
}

// getPackage: requires and parses package.json
function getPackage(type) {
  const basePath = type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..')

  const pkgPath = path.join(basePath, 'package.json')
  return JSON5.parse(jetpack.read(pkgPath))
}

// getRootPath: returns the root path of the project or package
function getRootPath(type) {
  return type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..')
}

// getLiveReloadPort: (35729)
function getLiveReloadPort() {
  // Check if the port is set in the environment
  process.env.OMEGA_LIVERELOAD_PORT = process.env.OMEGA_LIVERELOAD_PORT || 35729;

  // Return the port
  return parseInt(process.env.OMEGA_LIVERELOAD_PORT);
}

// getDevWebsiteOrigin: where the brand's dev website answers (protocol + port),
// as the live sibling website app published it beside its port map. An extension
// has no way to probe at runtime, so every dev-origin surface (the build.js
// blob, the page config blob, the manifest's externally_connectable) BAKES this
// one answer ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)).
//
// null when nothing published one: presence is a RESOLVED FACT, absence means
// "assume the classics" and say so (the N7 dev-map contract). A packaged build
// never probes at all: its artifact must not depend on whether a dev server
// happened to be running on the build machine.
function getDevWebsiteOrigin() {
  const { readSiblingOrigin } = require('@omega.js/config');

  if (getEnvironment() === 'production') {
    return null;
  }

  return readSiblingOrigin(getRootPath('project'));
}

// Touch files so a watcher rebuilds them
function triggerRebuild(files, log) {
  // Ensure logger is defined
  log = log || console;

  // Normalize files into an array of file names
  if (typeof files === 'string') {
    files = [files]; // Single string file name
  } else if (Array.isArray(files)) {
    // Already an array, no changes needed
  } else if (typeof files === 'object' && files !== null) {
    files = Object.keys(files); // Extract keys from object
  } else {
    log.error('Invalid files for triggerRebuild()');
    return;
  }

  // Set current time
  const now = new Date();

  // Touch all files to update mtime (so the watcher notices)
  files.forEach((file) => {
    try {
      fs.utimesSync(file, now, now);
      log.log(`Triggered build: ${file}`);
    } catch (e) {
      log.error(`Failed to trigger build ${file}`, e);
    }
  });
}

// Memory monitoring utility
function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    external: Math.round(used.external / 1024 / 1024),
  };
}

function logMemory(log, label) {
  const mem = getMemoryUsage();
  log.log(`[Memory ${label}] RSS: ${mem.rss}MB | Heap Used: ${mem.heapUsed}MB / ${mem.heapTotal}MB | External: ${mem.external}MB`);
}

// Export: the environment four + getVersion() come from the same plain
// functions the runtime contexts call
module.exports = {
  logger,
  getArguments,
  getBuildErrorNotificationArgs,
  reportNotificationFailure,
  reportBuildError,
  isBuildMode,
  getMode,
  actLikeProduction,
  getManifest,
  getConfig,
  getPackage,
  getRootPath,
  getLiveReloadPort,
  getDevWebsiteOrigin,
  triggerRebuild,
  getMemoryUsage,
  logMemory,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTesting,
  getVersion,
};
