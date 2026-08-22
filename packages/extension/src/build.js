// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const fs = require('fs');
const JSON5 = require('json5');
const argv = require('yargs')(process.argv.slice(2)).parseSync();
const { spawn } = require('child_process');
const { force } = require('node-powertools');

// Class
function Manager() {
  const self = this;

  // Properties
  self._logger = null;

  // Return
  return self;
}

// Initialize
Manager.prototype.initialize = function () {
  console.log('initialize:');
};

// Logger
Manager.prototype.logger = function (name) {
  // Check if called as static method (this is not a Manager instance)
  if (!(this instanceof Manager)) {
    // For static calls, just return a new logger without caching
    return new (require('./lib/logger'))(name);
  }

  // For instance calls, cache the logger
  if (!this._logger) {
    this._logger = new (require('./lib/logger'))(name);
  }

  return this._logger;
};

// argv
Manager.getArguments = function () {
  const options = argv || {};

  // Fix
  options._ = options._ || [];
  // browser can be: true (all), false (none), or a string like 'chrome' or 'chrome,firefox'
  options.browser = options.browser === undefined ? true : options.browser;
  options.debug = force(options.debug === undefined ? false : options.debug, 'boolean');

  // Return
  return options;
};
Manager.prototype.getArguments = Manager.getArguments;

// The notifly argv for a build error. Build messages routinely carry apostrophes
// and parentheses, so the message is a spawn ARG — never interpolated into a shell
// string, which mangled it and killed the notification (#104).
Manager.getBuildErrorNotificationArgs = function (plugin, message) {
  return [
    '--title', `Build Error: ${plugin}`,
    '--message', message,
    '--timeout', '3',
    '--sound', 'Sosumi',
  ];
};

// notifly is an optional local nicety, so a MISSING BINARY is one friendly note —
// never the raw `spawn notifly ENOENT` dump that used to land after a suite (#123).
// Every other spawn failure keeps the logged-not-thrown error path from #104.
Manager.reportNotificationFailure = function (error) {
  const logger = new (require('./lib/logger'))('build-error');

  if (error && error.code === 'ENOENT') {
    return logger.warn('notifly not installed — skipping desktop notification');
  }

  return logger.error('Failed to send notification', error);
};
Manager.prototype.reportNotificationFailure = Manager.reportNotificationFailure;

// Report build errors with notification
Manager.reportBuildError = function (error, callback) {
  const logger = new (require('./lib/logger'))('build-error');

  // Send notification using notifly
  const errorMessage = error.message || error.toString() || 'Unknown error';
  const errorPlugin = error.plugin || 'Build';

  spawn('notifly', Manager.getBuildErrorNotificationArgs(errorPlugin, errorMessage), { shell: false, stdio: 'ignore' })
    .on('error', (e) => Manager.reportNotificationFailure(e));

  // Log the error
  logger.error(`[${errorPlugin}] ${errorMessage}`);

  // If callback provided, call it with error
  if (callback) {
    return callback(error);
  }

  // Otherwise return a function that calls the callback with error
  return (cb) => cb ? cb(error) : error;
};
Manager.prototype.reportBuildError = Manager.reportBuildError;

// isBuildMode: checks if the build mode is enabled
Manager.isBuildMode = function () {
  return process.env.OMEGA_BUILD_MODE === 'true';
}
Manager.prototype.isBuildMode = Manager.isBuildMode;

// actLikeProduction - determines if we should act like production mode
Manager.actLikeProduction = function () {
  return Boolean(Manager.isBuildMode() || process.env.OMEGA_AUDIT_FORCE === 'true');
}
Manager.prototype.actLikeProduction = Manager.actLikeProduction;

// getEnvironment() is the SSOT and lives in src/utils/mode-helpers.js (alongside the is*()
// family). It's mixed onto the Manager via the attachTo() call below, same as in EM/UJM.

// getManifest: requires and parses config.yml
Manager.getManifest = function () {
  return JSON5.parse(jetpack.read('src/manifest.json') || '{}');
}
Manager.prototype.getManifest = Manager.getManifest;

// getConfig: the consumer's RESOLVED config/omega.json5 via @omega.js/config —
// shared sections at the top level, targets.extension overlaid onto them (brand
// walk-up applies in brand monorepos). Secrets never live in the file; the loader
// hard-fails on secret-shaped keys.
Manager.getConfig = function () {
  const { hasOmegaConfig, loadConfig, formatErrors } = require('@omega.js/config');

  // No config at all (fresh dir, non-consumer cwd) → empty shape; callers
  // optional-chain and the defaults task scaffolds the real file on setup.
  const cwd = process.cwd();
  if (!hasOmegaConfig(cwd)) {
    return {};
  }

  const { config, errors } = loadConfig(cwd, 'extension');

  // Validation findings are FATAL at build time — same contract as the web
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
Manager.prototype.getConfig = Manager.getConfig;

// getPackage: requires and parses package.json
Manager.getPackage = function (type) {
  const basePath = type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..')

  const pkgPath = path.join(basePath, 'package.json')
  return JSON5.parse(jetpack.read(pkgPath))
}
Manager.prototype.getPackage = Manager.getPackage;

// getRootPath: returns the root path of the project or package
Manager.getRootPath = function (type) {
  return type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..')
}
Manager.prototype.getRootPath = Manager.getRootPath;

// getLiveReloadPort: (35729)
Manager.getLiveReloadPort = function () {
  // Check if the port is set in the environment
  process.env.OMEGA_LIVERELOAD_PORT = process.env.OMEGA_LIVERELOAD_PORT || 35729;

  // Return the port
  return parseInt(process.env.OMEGA_LIVERELOAD_PORT);
}
Manager.prototype.getLiveReloadPort = Manager.getLiveReloadPort;

// getDevWebsiteOrigin: where the brand's dev website answers (protocol + port),
// as the live sibling website app published it beside its port map. An extension
// has no way to probe at runtime, so every dev-origin surface — the build.js
// blob, the page config blob, the manifest's externally_connectable — BAKES this
// one answer ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)).
//
// null when nothing published one: presence is a RESOLVED FACT, absence means
// "assume the classics" and say so (the N7 dev-map contract). A packaged build
// never probes at all — its artifact must not depend on whether a dev server
// happened to be running on the build machine.
Manager.getDevWebsiteOrigin = function () {
  const { readSiblingOrigin } = require('@omega.js/config');

  if (Manager.getEnvironment() === 'production') {
    return null;
  }

  return readSiblingOrigin(Manager.getRootPath('project'));
}
Manager.prototype.getDevWebsiteOrigin = Manager.getDevWebsiteOrigin;

// Create dummy file in project dist to force jekyll to build
Manager.triggerRebuild = function (files, logger) {
  // Ensure logger is defined
  logger = this?._logger || logger || console;

  // Normalize files into an array of file names
  if (typeof files === 'string') {
    files = [files]; // Single string file name
  } else if (Array.isArray(files)) {
    // Already an array, no changes needed
  } else if (typeof files === 'object' && files !== null) {
    files = Object.keys(files); // Extract keys from object
  } else {
    logger.error('Invalid files for triggerRebuild()');
    return;
  }

  // Set current time
  const now = new Date();

  // Touch all files to update mtime (so Jekyll notices)
  files.forEach((file) => {
    try {
      fs.utimesSync(file, now, now);
      logger.log(`Triggered build: ${file}`);
    } catch (e) {
      logger.error(`Failed to trigger build ${file}`, e);
    }
  });
}
Manager.prototype.triggerRebuild = Manager.triggerRebuild;

// Require
Manager.require = function (path) {
  return require(path);
};
Manager.prototype.require = Manager.require;

// Memory monitoring utility
Manager.getMemoryUsage = function () {
  const used = process.memoryUsage();
  return {
    rss: Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    external: Math.round(used.external / 1024 / 1024),
  };
};
Manager.prototype.getMemoryUsage = Manager.getMemoryUsage;

Manager.logMemory = function (logger, label) {
  const mem = Manager.getMemoryUsage();
  logger.log(`[Memory ${label}] RSS: ${mem.rss}MB | Heap Used: ${mem.heapUsed}MB / ${mem.heapTotal}MB | External: ${mem.external}MB`);
};
Manager.prototype.logMemory = Manager.logMemory;

// Cross-context helpers — Manager.isTesting() / isDevelopment() / etc.
require('./utils/mode-helpers.js').attachTo(Manager);

// Export
module.exports = Manager;
