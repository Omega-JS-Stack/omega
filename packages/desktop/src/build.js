// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const { setEnvironment, buildLaneEnvironment } = require('@omega.js/config/environment');
const fs = require('fs');
const JSON5 = require('json5');
const { force, execute } = require('node-powertools');
const { parseArgv } = require('@omega.js/devkit/argv');

// Class
function Manager() {
  const self = this;

  // Properties
  self._logger = null;

  // Return
  return self;
}

// Initialize (build-time hook)
Manager.prototype.initialize = function () {
  console.log('initialize:');
};

// Logger
Manager.prototype.logger = function (name) {
  // Static-style call
  if (!(this instanceof Manager)) {
    return new (require('./lib/logger'))(name);
  }

  // Cache one logger per Manager instance
  if (!this._logger) {
    this._logger = new (require('./lib/logger'))(name);
  }

  return this._logger;
};

// argv: the gulp lane's own parse. It is spawned with the TASK NAME alone
// (`npm run gulp -- build`), so `debug` is the one flag it declares.
Manager.getArguments = function () {
  const options = parseArgv(process.argv.slice(2), { booleans: ['debug'] });

  options.debug = force(options.debug === undefined ? false : options.debug, 'boolean');

  return options;
};
Manager.prototype.getArguments = Manager.getArguments;

// Report build errors with notification (parity with BXM)
Manager.reportBuildError = function (error, callback) {
  const logger = new (require('./lib/logger'))('build-error');
  const errorMessage = error.message || error.toString() || 'Unknown error';
  const errorPlugin = error.plugin || 'Build';

  logger.error(`[${errorPlugin}] ${errorMessage}`);

  if (callback) {
    return callback(error);
  }

  return (cb) => cb ? cb(error) : error;
};
Manager.prototype.reportBuildError = Manager.reportBuildError;

// Mode flags
Manager.isBuildMode = function () {
  return process.env.OMEGA_BUILD_MODE === 'true';
};
Manager.prototype.isBuildMode = Manager.isBuildMode;

Manager.isPublishMode = function () {
  return process.env.OMEGA_IS_PUBLISH === 'true';
};
Manager.prototype.isPublishMode = Manager.isPublishMode;

Manager.isServerMode = function () {
  return process.env.OMEGA_IS_SERVER === 'true';
};
Manager.prototype.isServerMode = Manager.isServerMode;

Manager.actLikeProduction = function () {
  return Boolean(Manager.isBuildMode() || process.env.OMEGA_AUDIT_FORCE === 'true');
};
Manager.prototype.actLikeProduction = Manager.actLikeProduction;

// The environment is the ONE module's (@omega.js/config's environment.js,
// [#817](https://github.com/Omega-JS-Stack/omega/issues/817)), reachable from
// all four @omega.js/desktop Manager entry points (main / renderer / preload /
// build) through the mode-helpers attachTo() call at the bottom of each, so
// every context resolves it identically. It reads ONE input and never guesses.
//
// THIS FILE IS THE NODE LANE'S ONE SETTER, and it runs at load, before any
// gulp task, verb or getConfig() asks. Two rules, no sniffing:
//   1. OMEGA_BUILD_MODE is the lane saying it is producing a PRODUCTION
//      artifact (`omega build` / `package` / `publish` / `release` all set it,
//      and so does the boot runner's staged build). It WINS over an inherited
//      variable, so a production build spawned from a test run still bakes
//      production.
//   2. Otherwise a lane that already named one keeps it (the test runners spawn
//      their children with `testing`), and a bare dev boot is `development`.
// Before #817 a dev boot with no signal answered `production` here, so
// `npm start` bundled itself as a production artifact, while the extension's
// copy of the same function answered `development` from the same inputs.
//
// The electron app this lane spawns inherits the variable; a PACKAGED app has
// no parent env, so main.js sets it from the baked config instead (the same
// word, written into the artifact by the bundle task).
setEnvironment(buildLaneEnvironment(Manager.isBuildMode()));

Manager.getMode = function () {
  return {
    build:   Manager.isBuildMode(),
    publish: Manager.isPublishMode(),
    server:  Manager.isServerMode(),
    environment: Manager.getEnvironment(),
  };
};
Manager.prototype.getMode = Manager.getMode;

// Config — the consumer's config/omega.json5 resolved for the desktop target via
// @omega.js/config: shared sections (brand, cloud, analytics, payment, monitoring,
// theme) at the top level, targets.desktop overlaid onto them (so app/platforms/startup/
// releases/... land at the top level here), and in a brand monorepo the brand root's
// config merges underneath the target's. Then @omega.js/desktop's derived defaults:
//   app.appId       ← certificates.providers.apple.bundleIdPrefix + brand.id,
//                     dashes as dots (`com.example` + `my-app` →
//                     `com.example.my.app`), the same id the
//                     certificates service registers (#909). No prefix
//                     declared → reverse-domain of brand.url
//                     (`https://foo.example.com` → `com.example.foo`), else
//                     `app.${brand.id}`: the BRAND owns the identity, never a
//                     hardcoded company (friction #18)
//   app.productName ← brand.name if not set
// These keep the consumer's config minimal: setting `brand: { id: 'foo', name: 'Foo',
// url: 'https://foo.com' }` is enough; appId/productName flow through automatically.
Manager.getConfig = function () {
  const { hasOmegaConfig, loadConfig, composeBundleId, deriveBundleIdPrefix } = require('@omega.js/config');

  // WHICH environment overlay composes
  // ([#856](https://github.com/Omega-JS-Stack/omega/issues/856)): a build bakes
  // a PRODUCTION artifact, so it names production rather than asking the
  // machine, which answers `development` in a terminal. That decision is now
  // made ONCE, at the top of this file, and lands in the one input (#817) that
  // every other read in the process answers from, so the overlay that composes
  // and the environment the artifact records can never be two different words.
  // Same rule, same shape, in @omega.js/extension's getConfig.
  const environment = Manager.getEnvironment();

  // No config at all (fresh dir, non-consumer cwd) → seeded empty shape below; the
  // schema validation in audit/boot reports what's actually missing.
  const cwd = process.cwd();
  const config = hasOmegaConfig(cwd) ? loadConfig(cwd, 'desktop', { environment }).config : {};

  // The environment rides ON the resolved config as the build fact every OMEGA
  // surface spells the same way ([#896](https://github.com/Omega-JS-Stack/omega/issues/896)),
  // so a dev boot loading config off disk hands main the same key a packaged
  // app reads out of OMEGA_BUILD_JSON.
  config.environment = environment;

  // Apply derived defaults. Always seed `brand` + `app` so callers can deref
  // `config.brand.X` / `config.app.X` without optional-chaining at every callsite.
  config.brand = config.brand || {};
  config.app   = config.app   || {};
  if (!config.app.appId) {
    // The bundle-id policy is @omega.js/config's ONE derivation (#909): a
    // config carrying an Apple prefix (its own, or the company layer's) signs
    // under the very id the certificates service registers. The URL host is
    // the fallback for a brand that declares no prefix, and a brand whose url
    // is a code-host repo is why it cannot be the rule.
    const prefix = config.certificates?.providers?.apple?.bundleIdPrefix;
    const derived = deriveBundleIdPrefix(config.brand.url || '');

    if (prefix && config.brand.id) {
      config.app.appId = composeBundleId(prefix, config.brand.id);
    } else if (derived) {
      config.app.appId = derived;
    } else if (config.brand.id) {
      config.app.appId = `app.${config.brand.id}`;
    }
  }
  if (!config.app.productName && config.brand.name) config.app.productName = config.brand.name;

  return config;
};
Manager.prototype.getConfig = Manager.getConfig;

// package.json
Manager.getPackage = function (type) {
  const basePath = type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');

  const pkgPath = path.join(basePath, 'package.json');
  const raw = jetpack.read(pkgPath);

  if (!raw) {
    return {};
  }

  return JSON5.parse(raw);
};
Manager.prototype.getPackage = Manager.getPackage;

// Root path
Manager.getRootPath = function (type) {
  return type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');
};
Manager.prototype.getRootPath = Manager.getRootPath;

// Live reload port
Manager.getLiveReloadPort = function () {
  process.env.OMEGA_LIVERELOAD_PORT = process.env.OMEGA_LIVERELOAD_PORT || 35729;
  return parseInt(process.env.OMEGA_LIVERELOAD_PORT, 10);
};
Manager.prototype.getLiveReloadPort = Manager.getLiveReloadPort;

// Windows signing strategy. Config-only: `platforms.windows.signing.strategy`
// (targets.desktop.platforms.windows in the raw omega.json5). Default 'self-hosted'.
Manager.getWindowsSignStrategy = function () {
  const config = Manager.getConfig();
  return config?.platforms?.windows?.signing?.strategy || 'self-hosted';
};
Manager.prototype.getWindowsSignStrategy = Manager.getWindowsSignStrategy;

// Touch files to trigger a rebuild watcher
Manager.triggerRebuild = function (files, logger) {
  logger = this?._logger || logger || console;

  if (typeof files === 'string') {
    files = [files];
  } else if (Array.isArray(files)) {
    // already an array
  } else if (typeof files === 'object' && files !== null) {
    files = Object.keys(files);
  } else {
    logger.error('Invalid files for triggerRebuild()');
    return;
  }

  const now = new Date();

  files.forEach((file) => {
    try {
      fs.utimesSync(file, now, now);
      logger.log(`Triggered build: ${file}`);
    } catch (e) {
      logger.error(`Failed to trigger build ${file}`, e);
    }
  });
};
Manager.prototype.triggerRebuild = Manager.triggerRebuild;

// Generic require passthrough (lets gulp tasks dynamically load lib modules).
// Only ever called from gulp tasks (release / package / bundle), which run
// un-bundled — so plain require is fine.
Manager.require = function (p) {
  return require(p);
};
Manager.prototype.require = Manager.require;

// Memory usage
Manager.getMemoryUsage = function () {
  const used = process.memoryUsage();
  return {
    rss:       Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed:  Math.round(used.heapUsed / 1024 / 1024),
    external:  Math.round(used.external / 1024 / 1024),
  };
};
Manager.prototype.getMemoryUsage = Manager.getMemoryUsage;

Manager.logMemory = function (logger, label) {
  const mem = Manager.getMemoryUsage();
  logger.log(`[Memory ${label}] RSS: ${mem.rss}MB | Heap Used: ${mem.heapUsed}MB / ${mem.heapTotal}MB | External: ${mem.external}MB`);
};
Manager.prototype.logMemory = Manager.logMemory;

// Mix in shared cross-context helpers — same code path used in main, renderer, preload.
// All four contexts share the exact same implementation.
require('./utils/mode-helpers.js').attachTo(Manager);
require('./utils/url-helpers.js').attachTo(Manager);

// Export
module.exports = Manager;
