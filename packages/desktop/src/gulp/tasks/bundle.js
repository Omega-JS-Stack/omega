// bundle — three bundles (main / preload / renderer), built in parallel.
// Each one gets `OMEGA_BUILD_JSON` baked in as a define.
//
// The bundler is esbuild since [#737](https://github.com/Omega-JS-Stack/omega/issues/737),
// and the file, the gulp task, the log tag and `npm run gulp -- bundle` were
// renamed off `webpack` with it — a task named after a bundler it no longer
// runs is a lie every reader has to unlearn.
//
// Every shared part comes from @omega.js/devkit's ONE bundle wrapper: the
// framework-deps resolve hook (#87 — a consumer requires a framework
// dependency by bare name and gets the FRAMEWORK's copy), the production
// `@dev-only` strip (#18), the minify/sourcemap rules by mode, and one timing
// line per build. What lives here is only what is genuinely desktop's: the
// three entry shapes, the Electron platform/target pair, the externals, the
// renderer's Node-builtin shim, and the OMEGA_BUILD_JSON bake.

const Manager = new (require('../../build.js'));
const logger = Manager.logger('bundle');
const path = require('path');
const glob = require('glob').globSync;
const jetpack = require('fs-jetpack');
const { readSiblingPorts, readSiblingOrigin, envPorts } = require('@omega.js/config');
const { bakeKeys } = require('@omega.js/config/env-delivery');
const { checkEnvRules } = require('@omega.js/config/env-rules');
const { resolveLicenseStamp } = require('@omega.js/devkit/license');
const { bundle, formatBytes } = require('@omega.js/devkit/bundle');
const { emptyModulesPlugin } = require('@omega.js/devkit/empty-modules-plugin');
const electronTargets = require('../../utils/electron-targets.js');

const projectRoot   = Manager.getRootPath('project');
const frameworkRoot = Manager.getRootPath();
const outputRoot    = require('../../utils/dist-root.js')(projectRoot);

// The renderer runs with contextIsolation on: a browser-like environment with
// no Node globals. Libraries bundled through @omega.js/client (firebase and
// friends) still IMPORT Node built-ins on code paths their browser builds never
// take, so a browser bundle has to answer those imports with something. webpack
// answered `resolve.fallback: { fs: false, ... }`; esbuild has no such option,
// so the same list goes to @omega.js/devkit's `emptyModulesPlugin` — the shared
// hook, because @omega.js/extension's browser bundles need the same answer.
//
// `electron` is on the list for the same reason and a sharper one: a renderer
// that reached the real electron module would be a security hole, not a missing
// polyfill. That is why the hook answers UNCONDITIONALLY and never resolves
// first — `electron` DOES resolve from a desktop project.
const RENDERER_EMPTY_MODULES = [
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'http2', 'net', 'tls', 'dns',
  'child_process', 'stream', 'zlib', 'util', 'url', 'assert', 'events', 'buffer',
  'querystring', 'string_decoder', 'electron',
];

// The blob every bundle reads as OMEGA_BUILD_JSON.config — and the ONLY thing
// the renderer hands @omega.js/client (renderer.js merges `buildJson.config`
// with the runtime overrides). The app's VERSION rides INSIDE it for that
// reason: the client tags every error report `<brand.id>@<version>` and falls
// back to the build stamp without one (#380), and it never sees the sibling
// `package` key. The dev map (#300) is a dev-build key only.
function composeBuildConfig(config, dev, pkg) {
  return { ...config, version: pkg.version, ...(dev ? { dev } : {}) };
}

// OMEGA_BUILD_JSON itself — the build's own record of what it produced. The
// `license` stamp ([#320](https://github.com/Omega-JS-Stack/omega/issues/320))
// rides HERE and not inside `config`: it is a fact about the build, not part
// of the client contract the renderer hands @omega.js/client. Nothing in the
// app reads it today (a packaged app has no attribution surface, and payments
// ride the backend's own gate) — it is what makes an artifact say which
// verdict it was packaged under.
function composeBuildJson({ config, dev, pkg, mode, license }) {
  return {
    config: composeBuildConfig(config, dev, pkg),
    package: pkg,
    mode,
    license,
    builtAt: new Date().toISOString(),
  };
}

module.exports = function bundleTask(done) {
  const mode = Manager.getMode();
  const isProd = mode.environment === 'production';
  const config = Manager.getConfig();

  // The renderer's @omega.js/client reads `config.dev` to reach the local
  // stack (N7). A renderer has no env and no filesystem walk of its own, so
  // the map has to be BAKED — the sibling backend's published map (this
  // brand's live emulator suite) plus anything a parent injected on the env
  // channel, resolved on every build so a rebuild picks up a restarted
  // emulator ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)).
  // The sibling website's published dev ORIGIN rides the same bake
  // ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)); a key
  // present is a resolved fact, absent means the client assumes and warns.
  // Never in production: a packaged app has no local stack.
  const devOrigin = isProd ? null : readSiblingOrigin(projectRoot);
  const dev = isProd ? null : {
    ports: { ...readSiblingPorts(projectRoot), ...envPorts() },
    ...(devOrigin ? { origin: devOrigin } : {}),
  };

  // The license check (#320), once per build: a PRODUCTION build asks the
  // license server (a key that cannot be answered for THROWS, which is what
  // gates a bad-key release); a dev build is keyless by definition and never
  // phones home. The answer is stamped into the build blob below.
  const projectPackage = Manager.getPackage('project');
  resolveLicenseStamp({ config, production: isProd })
    .then((license) => {
      // OMEGA_BUILD_JSON — frozen at build time, accessible at runtime as window/globalThis.OMEGA_BUILD_JSON.
      const buildJson = composeBuildJson({ config, dev, pkg: projectPackage, mode, license });

      logger.log(`bundling — environment=${mode.environment}, license=${license.status}`);
      runBundles(buildJson, isProd).then(() => done()).catch(done);
    })
    .catch(done);
};

/**
 * Build the bundles the consumer has entries for, in parallel.
 * @param {object} buildJson - The blob every bundle bakes.
 * @param {boolean} isProd - Production build.
 * @returns {Promise<void>}
 */
async function runBundles(buildJson, isProd) {
  // Composed ONCE and handed down: `buildJsonDefines` runs the env-schema bake
  // guard, so building it per bundle repeated the same warning three times for
  // one missing key, and `resolveTargets` spawns the Electron probe.
  const shared = {
    define: buildJsonDefines(buildJson, isProd),
    banner: buildJsonBanner(buildJson),
    targets: resolveTargets(),
    dev: !isProd,
  };

  const builds = [
    mainBundle(shared),
    preloadBundle(shared),
    rendererBundle(shared),
  ].filter(Boolean);

  if (builds.length === 0) {
    logger.warn('No bundles to build.');
    return;
  }

  // esbuild rejects with every error already formatted, so a failed build
  // surfaces through gulp's own callback rather than a hand-rolled reporter.
  const results = await Promise.all(builds.map(async (build) => ({
    name: build.name,
    result: await bundle(build.options),
  })));

  // The metafile is what the wrapper turns on for exactly this: what each
  // bundle produced, and how big.
  results.forEach(({ name, result }) => {
    logger.log(`built ${name}:`);
    Object.entries(result.metafile.outputs).forEach(([file, meta]) => {
      logger.log(`  ${path.basename(file)} (${formatBytes(meta.bytes)})`);
    });
  });
}

// The Electron the CONSUMER pinned decides the syntax floor of all three
// bundles — see utils/electron-targets.js. The binary is resolved from the
// FRAMEWORK's module context, which is the same lookup build-config pins
// `electronVersion` with: the version that ends up RUNNING the bundles is the
// version they must compile for.
function resolveTargets() {
  try {
    return electronTargets(Manager.require('electron'), { logger });
  } catch (e) {
    logger.warn(`Could not resolve electron (${e.message}) — bundles compile with no syntax floor.`);
    return { node: null, chrome: null, electron: null };
  }
}

// Inject OMEGA_BUILD_JSON into every bundle two ways:
// 1. `define` replaces the bare `OMEGA_BUILD_JSON` identifier with the literal at build time
//    (so framework code can reference it without globals).
// 2. `banner` prepends a tiny IIFE that assigns the same value to globalThis.OMEGA_BUILD_JSON
//    (so it's reachable from DevTools and consumer code via window.OMEGA_BUILD_JSON).
//
// Also: bake the schema's build-time secrets into the bundle as `process.env.<KEY>`
// replacements. Packaged apps don't ship .env, so without this the analytics
// module would have no secret at runtime in production. Local dev still reads
// from process.env (the replacement only fires when the build runs with the key
// set; otherwise the reference is left intact).
function buildJsonDefines(buildJson, isProd) {
  return {
    OMEGA_BUILD_JSON: JSON.stringify(buildJson),
    // webpack derived this from its `mode`; esbuild has no modes, so the switch
    // every bundled library reads is stated here instead. Dropping it would
    // ship every library's DEVELOPMENT branch into a packaged app.
    'process.env.NODE_ENV': isProd ? '"production"' : '"development"',
    // The bake is guarded by the schema's presence rules (#626): the brand's
    // own resolved config says which keys it owes, and the mode says what a
    // violation costs.
    ...bakeDefinitions(process.env, { config: buildJson.config, mode: buildJson.mode }),
  };
}

/**
 * The globalThis/window assignment every bundle carries.
 * @param {object} buildJson - The blob every bundle bakes.
 * @returns {object} an esbuild banner
 */
function buildJsonBanner(buildJson) {
  const literal = JSON.stringify(buildJson);
  return {
    js: `(function(){var __em=${literal};if(typeof globalThis!=='undefined'){globalThis.OMEGA_BUILD_JSON=__em;}if(typeof window!=='undefined'){window.OMEGA_BUILD_JSON=__em;}})();`,
  };
}

// The keys the env schema says this build writes INTO the shipped artifact
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)) — the hardcoded
// GOOGLE_ANALYTICS_SECRET read this replaced was one of three hand-kept lists
// for one concern. A new baked key is one schema entry and nothing here.
const BAKED_KEYS = bakeKeys('desktop');

/**
 * The schema's presence rules at the BAKE seam
 * ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)) — the last
 * moment a missing key is still fixable.
 *
 * A packaged app ships no `.env`, so what the bundle holds is what the app
 * holds forever: a brand with a GA4 stream id and no Measurement Protocol
 * secret used to bundle NO replacement at all and ship an app that sends no
 * events, silently — and a CI build, which has no `.env` on the runner, is
 * exactly where that happens. A build/publish run refuses; a development build
 * warns and keeps going, because a half-configured brand is a normal step on
 * the way to a configured one.
 *
 * @param {object} config - The target's resolved omega.json5 config.
 * @param {object} env - The build env.
 * @param {object} [options]
 * @param {object} [options.mode] - The Manager's mode (`{ build, publish, … }`).
 * @param {object} [options.logger] - Logger with `warn` (default: this task's).
 * @throws {Error} in build/publish mode, naming every brand-level key and the config path that requires it.
 */
function assertBakeRules(config, env, options) {
  options = options || {};
  const mode = options.mode || Manager.getMode();
  const warn = (options.logger || logger).warn.bind(options.logger || logger);

  const violations = checkEnvRules(config, env, { target: 'desktop' })
    .filter((violation) => violation.rule === 'requiredWhen');
  if (violations.length === 0) return;

  // The BRAND-LEVEL key name (GOOGLE_ANALYTICS_SECRET_DESKTOP, not the
  // GOOGLE_ANALYTICS_SECRET it is delivered as): that is the name a human puts
  // in the brand .env and in the repo's Actions secrets.
  const named = violations.map(({ key, path }) => `${key} (required by ${path})`).join(', ');
  const message = `${violations.length} env ${violations.length === 1 ? 'key this brand\'s config requires is' : 'keys this brand\'s config requires are'} missing from the build env: ${named}. `
    + 'Set it in the brand .env (and as a repo Actions secret for a CI build — `omega push-secrets` sends them), then build again.';

  if (mode.build || mode.publish) {
    throw new Error(message);
  }

  warn(message);
}

/**
 * The `define` replacements for the baked keys the build env carries. A key
 * with no value is left OUT, so the bundle keeps its live `process.env` read —
 * that is how a local dev run still picks the value up from the cascade.
 *
 * The presence guard runs FIRST: a build that would ship an unreplaced
 * reference over a configured stream refuses here rather than shipping the hole.
 *
 * @param {object} [env] - Env map (default: process.env).
 * @param {object} [options] - `{ config, mode, logger }` — the guard's inputs; without a config there is no rule to answer.
 * @returns {Object<string, string>} `process.env.KEY` → JSON literal.
 */
function bakeDefinitions(env, options) {
  env = env || process.env;

  if (options && options.config) {
    assertBakeRules(options.config, env, options);
  }

  const definitions = {};
  for (const key of BAKED_KEYS) {
    if (env[key]) definitions[`process.env.${key}`] = JSON.stringify(env[key]);
  }

  return definitions;
}

/**
 * The main process bundle: CommonJS on Node, electron and every native module
 * left external.
 * @param {object} shared - `{ define, banner, targets, dev }`, composed once per run
 * @returns {object|null} `{ name, options }`, or null when the consumer has no entry
 */
function mainBundle(shared) {
  const entry = path.join(projectRoot, 'src', 'main.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/main.js in consumer — skipping main bundle.');
    return null;
  }

  return {
    name: 'main',
    options: {
      frameworkRoot,
      entries: [entry],
      outfile: path.join(outputRoot, 'main.bundle.js'),
      platform: 'node',
      format: 'cjs',
      target: shared.targets.node,
      // Native modules stay OUT of the bundle so electron-builder's afterPack
      // rebuilds them; electron is provided by the runtime itself.
      external: ['electron', ...nativeExternals()],
      dev: shared.dev,
      define: shared.define,
      banner: shared.banner,
    },
  };
}

/**
 * The preload bundle: same shape as main. `platform: 'node'` leaves every Node
 * built-in external exactly as it does for main, so the only name worth stating
 * is electron — and a preload rebuilds no native module of its own.
 * @param {object} shared - `{ define, banner, targets, dev }`, composed once per run
 * @returns {object|null} `{ name, options }`, or null when the consumer has no entry
 */
function preloadBundle(shared) {
  const entry = path.join(projectRoot, 'src', 'preload.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/preload.js in consumer — skipping preload bundle.');
    return null;
  }

  return {
    name: 'preload',
    options: {
      frameworkRoot,
      entries: [entry],
      outfile: path.join(outputRoot, 'preload.bundle.js'),
      platform: 'node',
      format: 'cjs',
      target: shared.targets.node,
      external: ['electron'],
      dev: shared.dev,
      define: shared.define,
      banner: shared.banner,
    },
  };
}

/**
 * The output name of a component entry: the directory holding its `index.js`.
 * Either separator, because glob answers `settings/index.js` on macOS and
 * Linux and `settings\index.js` on Windows, and a strip that assumed the
 * forward slash keyed EVERY Windows entry `index.js`, collapsing all three
 * renderer bundles onto one output file
 * ([#806](https://github.com/Omega-JS-Stack/omega/issues/806)).
 * @param {string} rel - The entry's path relative to the components dir, as glob returned it
 * @returns {string} the key esbuild's `[name]` writes the bundle under
 */
function rendererEntryKey(rel) {
  return rel.replace(/[\\/]index\.js$/, '');
}

/**
 * One browser bundle per `src/assets/js/components/<name>/index.js`, loaded by
 * the page template as a plain `<script src>` — so iife, not esm.
 * @param {object} shared - `{ define, banner, targets, dev }`, composed once per run
 * @returns {object|null} `{ name, options }`, or null when the consumer has no entries
 */
function rendererBundle(shared) {
  const componentsDir = path.join(projectRoot, 'src', 'assets', 'js', 'components');
  if (!jetpack.exists(componentsDir)) {
    logger.warn('No src/assets/js/components/ in consumer — skipping renderer bundles.');
    return null;
  }

  // One bundle per components/<name>/index.js
  const indexFiles = glob('*/index.js', { cwd: componentsDir });
  if (indexFiles.length === 0) {
    logger.warn('No component index.js entries found.');
    return null;
  }

  // Keys name the outputs: components/settings/index.js → settings.bundle.js,
  // which is the file the page template's <script src> asks for.
  const entries = {};
  indexFiles.forEach((rel) => {
    entries[rendererEntryKey(rel)] = path.join(componentsDir, rel);
  });

  return {
    name: 'renderer',
    options: {
      frameworkRoot,
      entries,
      outdir: path.join(outputRoot, 'assets', 'js', 'components'),
      entryNames: '[name].bundle',
      platform: 'browser',
      format: 'iife',
      target: shared.targets.chrome,
      dev: shared.dev,
      // Vendored core assets (#111) — mirrors the alias BXM/UJM use, so
      // renderer code imports shared core modules by a stable name:
      //   import appShell from '__main_assets__/js/core/app-shell.js';
      alias: {
        '__main_assets__': path.join(frameworkRoot, 'dist', 'assets'),
      },
      define: {
        ...shared.define,
        // Libraries like lodash/@firebase/util reference the Node-ism `global`;
        // a browser bundle leaves it undefined, so it is rewritten textually.
        global: 'globalThis',
      },
      banner: shared.banner,
      plugins: [emptyModulesPlugin(RENDERER_EMPTY_MODULES)],
    },
  };
}

/**
 * The consumer's truly native (C++) modules — they must stay out of the bundle
 * so electron-builder's afterPack rebuilds them against Electron's ABI.
 * electron-store is pure JS (ESM) so it bundles fine.
 * @returns {string[]} module names to leave external
 */
function nativeExternals() {
  const NATIVE = [
    'better-sqlite3',
    'keytar',
    'node-mac-permissions',
    'node-notifier',
    'sharp',
    'sqlite3',
  ];

  const consumerPkg = Manager.getPackage('project');
  const declared = Object.assign({}, consumerPkg.dependencies || {}, consumerPkg.devDependencies || {});

  return Object.keys(declared).filter((name) => NATIVE.includes(name));
}

// The list behind the renderer's Node-builtin shim (#737) — pinned by
// src/test/suites/build/renderer-node-shims.test.js.
module.exports.RENDERER_EMPTY_MODULES = RENDERER_EMPTY_MODULES;
module.exports.composeBuildConfig = composeBuildConfig;
module.exports.composeBuildJson = composeBuildJson;
module.exports.rendererEntryKey = rendererEntryKey;
// The schema-derived bake set and its reader (#627).
module.exports.BAKED_KEYS = BAKED_KEYS;
module.exports.bakeDefinitions = bakeDefinitions;
