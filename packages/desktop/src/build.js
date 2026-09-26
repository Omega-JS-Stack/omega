// The build-time module: one plain object of functions every gulp task, verb
// and consumer hook reads (`const build = require('@omega.js/desktop/build')`).
// No class and no `new`, the shape @omega.js/web's and @omega.js/extension's
// build modules share.

// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const { setEnvironment, buildLaneEnvironment } = require('@omega.js/config/environment');
const fs = require('fs');
const JSON5 = require('json5');
const { force } = require('node-powertools');
const { parseArgv } = require('@omega.js/devkit/argv');
const { getEnvironment, isDevelopment, isProduction, isTesting, getVersion } = require('./utils/mode-helpers.js');

// Logger: a named build logger
function logger(name) {
  return new (require('@omega.js/devkit/logger'))(name);
}

// argv: the gulp lane's own parse. It is spawned with the TASK NAME alone
// (`npm run gulp -- build`), so `debug` is the one flag it declares.
function getArguments() {
  const options = parseArgv(process.argv.slice(2), { booleans: ['debug'] });

  options.debug = force(options.debug === undefined ? false : options.debug, 'boolean');

  return options;
}

// Report build errors with notification (parity with @omega.js/extension)
function reportBuildError(error, callback) {
  const log = logger('build-error');
  const errorMessage = error.message || error.toString() || 'Unknown error';
  const errorPlugin = error.plugin || 'Build';

  log.error(`[${errorPlugin}] ${errorMessage}`);

  if (callback) {
    return callback(error);
  }

  return (cb) => cb ? cb(error) : error;
}

// Mode flags
function isBuildMode() {
  return process.env.OMEGA_BUILD_MODE === 'true';
}

function isPublishMode() {
  return process.env.OMEGA_IS_PUBLISH === 'true';
}

function isServerMode() {
  return process.env.OMEGA_IS_SERVER === 'true';
}

function actLikeProduction() {
  return Boolean(isBuildMode() || process.env.OMEGA_AUDIT_FORCE === 'true');
}

// The environment is the ONE module's (@omega.js/config's environment.js,
// [#817](https://github.com/Omega-JS-Stack/omega/issues/817)), reachable from
// all four @omega.js/desktop entry points (the main / renderer / preload `Omega`
// classes and this build module) through the same plain functions in
// utils/mode-helpers.js, so every context resolves it identically. It reads ONE
// input and never guesses.
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
setEnvironment(buildLaneEnvironment(isBuildMode()));

function getMode() {
  return {
    build:   isBuildMode(),
    publish: isPublishMode(),
    server:  isServerMode(),
    environment: getEnvironment(),
  };
}

// Config: the consumer's config/omega.json5 resolved for the desktop target via
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
function getConfig() {
  const { hasOmegaConfig, loadConfig, composeBundleId, deriveBundleIdPrefix } = require('@omega.js/config');

  // WHICH environment overlay composes
  // ([#856](https://github.com/Omega-JS-Stack/omega/issues/856)): a build bakes
  // a PRODUCTION artifact, so it names production rather than asking the
  // machine, which answers `development` in a terminal. That decision is now
  // made ONCE, at the top of this file, and lands in the one input (#817) that
  // every other read in the process answers from, so the overlay that composes
  // and the environment the artifact records can never be two different words.
  // Same rule, same shape, in @omega.js/extension's getConfig.
  const environment = getEnvironment();

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
}

// package.json
function getPackage(type) {
  const basePath = type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');

  const pkgPath = path.join(basePath, 'package.json');
  const raw = jetpack.read(pkgPath);

  if (!raw) {
    return {};
  }

  return JSON5.parse(raw);
}

// Root path
function getRootPath(type) {
  return type === 'project'
    ? process.cwd()
    : path.resolve(__dirname, '..');
}

// Live reload port
function getLiveReloadPort() {
  process.env.OMEGA_LIVERELOAD_PORT = process.env.OMEGA_LIVERELOAD_PORT || 35729;
  return parseInt(process.env.OMEGA_LIVERELOAD_PORT, 10);
}

// Windows signing strategy. Config-only: `platforms.windows.signing.strategy`
// (targets.desktop.platforms.windows in the raw omega.json5). Default 'self-hosted'.
function getWindowsSignStrategy() {
  const config = getConfig();
  return config?.platforms?.windows?.signing?.strategy || 'self-hosted';
}

// Touch files to trigger a rebuild watcher
function triggerRebuild(files, log) {
  log = log || console;

  if (typeof files === 'string') {
    files = [files];
  } else if (Array.isArray(files)) {
    // already an array
  } else if (typeof files === 'object' && files !== null) {
    files = Object.keys(files);
  } else {
    log.error('Invalid files for triggerRebuild()');
    return;
  }

  const now = new Date();

  files.forEach((file) => {
    try {
      fs.utimesSync(file, now, now);
      log.log(`Triggered build: ${file}`);
    } catch (e) {
      log.error(`Failed to trigger build ${file}`, e);
    }
  });
}

// Memory usage
function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss:       Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed:  Math.round(used.heapUsed / 1024 / 1024),
    external:  Math.round(used.external / 1024 / 1024),
  };
}

function logMemory(log, label) {
  const mem = getMemoryUsage();
  log.log(`[Memory ${label}] RSS: ${mem.rss}MB | Heap Used: ${mem.heapUsed}MB / ${mem.heapTotal}MB | External: ${mem.external}MB`);
}

// Export: the environment four + getVersion() come from the same plain
// functions the runtime `Omega` classes call
module.exports = {
  logger,
  getArguments,
  reportBuildError,
  isBuildMode,
  isPublishMode,
  isServerMode,
  actLikeProduction,
  getMode,
  getConfig,
  getPackage,
  getRootPath,
  getLiveReloadPort,
  getWindowsSignStrategy,
  triggerRebuild,
  getMemoryUsage,
  logMemory,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTesting,
  getVersion,
};
