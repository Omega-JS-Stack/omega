// bundle — one esbuild pass over every browser entry point the project has.
//
// The bundler is esbuild since [#738](https://github.com/Omega-JS-Stack/omega/issues/738),
// and the file, the gulp task and the log tag were renamed off `webpack` with
// it — a task named after a bundler it no longer runs is a lie every reader has
// to unlearn. @babel/preset-env went with webpack: esbuild's `target` IS the
// syntax floor, stated once below.
//
// Every shared part comes from @omega.js/devkit's ONE bundle wrapper: the
// framework-deps resolve hook (#87 — a consumer requires a framework dependency
// by bare name and gets the FRAMEWORK's copy), the production `@dev-only` strip
// (#18), the minify/sourcemap rules by mode, and one timing line per build.
// What lives here is only what is genuinely the extension's: the entry
// discovery, the browser syntax floor, the asset/theme aliases, the Node-builtin
// shim, the `%%%key%%%` substitution, and the OMEGA_BUILD_JSON bake.
//
// The bake ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)) is
// @omega.js/desktop's, key for key: `define` replaces the bare identifier at
// compile time and `banner` prepends the global assignment, so every emitted
// bundle carries its own copy. package.js used to write the snapshot as a
// `packaged/<target>/raw/build.js` JSONP file (plus a `build.json` sidecar
// nothing read) that the service worker importScripts()'d and every page loaded
// with its own <script> tag — one baked config, two techniques on sibling
// frameworks. Neither file is written any more.
//
// ONE call covers every lane. webpack needed three configs because code
// SPLITTING had to be switched off per lane (a service worker and a content
// script cannot fetch a chunk under MV3's CSP); esbuild's `iife` format has no
// splitting at all, so background, content scripts and the extension pages all
// take the same options and each bundle is one self-contained file.

// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('bundle');
const watcherLogger = Manager.logger('bundle:watcher');
const { watch, series } = require('gulp');
const glob = require('glob').globSync;
const path = require('path');
const jetpack = require('fs-jetpack');
const { template } = require('node-powertools');
const version = require('wonderful-version');
const { bundle, formatBytes } = require('@omega.js/devkit/bundle');
const { emptyModulesPlugin } = require('@omega.js/devkit/empty-modules-plugin');
const { resolveThemeId } = require('../../lib/theme.js');
const { readSiblingPorts, envPorts } = require('@omega.js/config');
const { bakeKeys } = require('@omega.js/config/env-delivery');
const { checkEnvRules } = require('@omega.js/config/env-rules');
const { resolveLicenseStamp } = require('@omega.js/devkit/license');

// Load package
const project = Manager.getPackage('project');
const frameworkPackage = Manager.getPackage('main');
const manifest = Manager.getManifest();
const config = Manager.getConfig();
const rootPathPackage = Manager.getRootPath('main');
const rootPathProject = Manager.getRootPath('project');

// Themes are per-framework (#261) — a shared theme.id naming a WEB theme falls
// back to the extension's default instead of aliasing a directory that isn't there.
const themesDir = path.resolve(rootPathPackage, 'dist/assets/themes');
const themeId = resolveThemeId(config.theme?.id, { themesDir, logger });

// Chrome 88 is where MV3 shipped — nothing older can load the artifact at all.
const CHROME_MV3_FLOOR = 88;
// Firefox 91 is the `strict_min_version` the framework's default manifest
// (src/config/manifest.json) ships, so it is the floor of an extension that
// declares none of its own.
const FIREFOX_MV3_FLOOR = 91;

/**
 * The syntax floor, READ from the manifest (it was @babel/preset-env's
 * browserslist guess before #738). The project already declares its floor in
 * the one place a browser reads — `minimum_chrome_version` and
 * `browser_specific_settings.gecko.strict_min_version` — so the bundler takes
 * it from there and moves whenever the consumer moves it. Undeclared, each
 * side falls back to its MV3 minimum above. esbuild compiles SYNTAX down to
 * this pair and leaves everything newer alone; it never polyfills a runtime
 * API, which is the one thing preset-env's core-js path could have done and
 * this build never asked it to.
 * @param {object} manifest - the project's manifest (`Manager.getManifest()`)
 * @returns {string[]} esbuild targets, `['chrome<n>', 'firefox<n>']`
 */
function resolveSyntaxTarget(manifest) {
  const chrome = majorVersion(manifest.minimum_chrome_version);
  const firefox = majorVersion(manifest.browser_specific_settings?.gecko?.strict_min_version);

  return [
    `chrome${chrome || CHROME_MV3_FLOOR}`,
    `firefox${firefox || FIREFOX_MV3_FLOOR}`,
  ];
}

/**
 * The major of a declared manifest version (`'91.0'`, `'110'`), or null when
 * the value is not one — a floor nobody can parse must not become an invented
 * esbuild target.
 * @param {string|number} [declared] - the manifest value
 * @returns {number|null}
 */
function majorVersion(declared) {
  const major = parseInt(String(declared).split('.')[0], 10);
  return Number.isInteger(major) ? major : null;
}

const SYNTAX_TARGET = resolveSyntaxTarget(manifest);

// Extension pages, content scripts and the service worker are all browser
// environments with no Node built-ins, but libraries bundled through
// @omega.js/client (firebase and friends) still IMPORT them on code paths their
// browser builds never take. webpack answered `resolve.fallback: { fs: false, … }`;
// esbuild has no such option, so the same list goes to @omega.js/devkit's
// `emptyModulesPlugin` — the shared hook, the same one @omega.js/desktop's
// renderer passes its own list to.
const BROWSER_EMPTY_MODULES = [
  'fs', 'path', 'crypto', 'os', 'util', 'assert', 'stream', 'buffer', 'process',
];

// The build-time tokens consumer and framework browser code writes, and the
// brackets they are spelled with (`%%%version%%%`). package.js speaks the same
// idiom over the manifest.
const TEMPLATE_BRACKETS = ['%%%', '%%%'];

// Define bundle files separately for easier tracking
const bundleFiles = [
  // Main bundles (if any exist in bundles/ directory)
  `${rootPathPackage}/dist/assets/js/bundles/*.js`,

  // Project bundles
  'src/assets/js/bundles/*.js',
];

// Entry points to compile (only index.js files)
const input = [
  // Bundle files (if any exist)
  ...bundleFiles,

  // Component-specific JS (only index.js entry points)
  `${rootPathPackage}/dist/assets/js/components/**/index.js`,
  'src/assets/js/components/**/index.js',
];

// Additional files to watch (but not compile as entry points)
const watchInput = [
  // Watch the paths we're compiling
  ...input,

  // Core JS - watch for changes but don't compile as entry points
  `${rootPathPackage}/dist/assets/js/**/*.js`,
  `${rootPathProject}/src/assets/js/**/*.js`,

  // Theme js - watch for changes but don't compile as entry points
  `${rootPathPackage}/dist/assets/themes/**/*.js`,
  'src/assets/themes/**/*.js',

  // All project assets js - watch for changes but don't compile as entry points
  'src/assets/js/**/*.js',

  // All BXM package src files - watch for changes (includes background.js, popup.js, etc.)
  `${rootPathPackage}/src/**/*.js`,

  // So we can watch for changes while we're developing @omega.js/client
  `${rootPathPackage}/../client/src`,
];

const delay = 250;
const compiled = {};

/**
 * The one esbuild build: every discovered entry, one self-contained iife each.
 * @returns {Promise<object|null>} esbuild's result (metafile on), or null when the project has no entries
 */
async function runBundle() {
  const entries = updateEntryPoints(input);

  if (Object.keys(entries).length === 0) {
    logger.warn('No entry points found.');
    return null;
  }

  // OMEGA_BUILD_JSON — frozen at build time and carried by EVERY emitted bundle,
  // the service worker and the pages alike ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
  const buildJson = await composeBuildJson();

  const result = await bundle({
    frameworkRoot: rootPathPackage,
    // The KEY is the output path under `outdir`, extension included by
    // entryNames' absence: `components/popup.bundle` → components/popup.bundle.js,
    // which is the file the page template's <script src> and the manifest's
    // `background.service_worker` ask for.
    entries,
    outdir: path.resolve(process.cwd(), 'dist/assets/js'),
    platform: 'browser',
    // iife, never esm: every bundle is loaded as a plain <script src>, a
    // content script, or an MV3 service worker registered as a classic script.
    format: 'iife',
    target: SYNTAX_TARGET,
    dev: !Manager.actLikeProduction(),
    alias: {
      // For importing assets
      '__main_assets__': path.resolve(rootPathPackage, 'dist/assets'),
      '__project_assets__': path.resolve(process.cwd(), 'src/assets'),

      // For importing the theme
      '__theme__': path.resolve(themesDir, themeId),
    },
    define: buildJsonDefines(buildJson),
    banner: buildJsonBanner(buildJson),
    plugins: [emptyModulesPlugin(BROWSER_EMPTY_MODULES)],
  });

  // What each entry cost, from the metafile the wrapper turns on. Printed
  // BEFORE the substitution below, because the metafile's byte counts are what
  // esbuild emitted — reading them after a rewrite would report stale numbers.
  Object.entries(result.metafile.outputs).forEach(([file, meta]) => {
    logger.log(`  ${path.relative(process.cwd(), file)} (${formatBytes(meta.bytes)})`);
  });

  // The `%%%key%%%` pass, over what the build just emitted. webpack ran it as a
  // processAssets hook; esbuild has no mutate-then-rewrite stage, so it happens
  // here — after minification, which is the only ordering that matters (the
  // tokens live inside string literals and survive it intact).
  const emitted = Object.keys(result.metafile.outputs)
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.resolve(file));
  substituteTemplates(emitted, getTemplateReplaceOptions());

  return result;
}

/**
 * Fill every `%%%key%%%` token in the given files from the replacement set. A
 * key nothing answers is LEFT INTACT (node-powertools' template semantics), so
 * a consumer's own unrelated `%%%` text is never emptied out.
 * @param {string[]} files - absolute paths of the emitted JS files
 * @param {object} replacements - the replacement set (see getTemplateReplaceOptions)
 * @returns {number} how many files changed
 */
function substituteTemplates(files, replacements) {
  let changed = 0;

  files.forEach((file) => {
    const contents = jetpack.read(file);
    if (!contents) return;

    const replaced = template(contents, replacements, { brackets: TEMPLATE_BRACKETS });
    if (replaced === contents) return;

    jetpack.write(file, replaced);
    changed++;
  });

  return changed;
}

// The blob every bundle reads as `OMEGA_BUILD_JSON.config` — and the ONLY thing
// the extension contexts hand @omega.js/client. An extension page and a service
// worker have no env and no filesystem walk of their own, so the bake is their
// one channel; it lived in package.js as a `build.js` JSONP file the SW
// importScripts()'d and every page loaded with its own <script> tag until
// [#743](https://github.com/Omega-JS-Stack/omega/issues/743) moved it into the
// bundles themselves, the shape @omega.js/desktop has always used.
function composeBuildConfig() {
  // omega.json5 `monitoring.providers.sentry` → the client's sentry contract
  // (#425). The provider block feeds Sentry.init directly; the role level
  // (`enabled`) never rides along.
  const sentryConfig = { ...(config.monitoring?.providers?.sentry || {}) };

  // The live sibling website's published origin, or null when none is up (#262)
  const devWebsiteOrigin = Manager.getDevWebsiteOrigin();

  // The Measurement Protocol secret (.env — secrets never live in omega.json5).
  const googleAnalyticsId = config.analytics?.providers?.google?.id || '';
  const googleAnalyticsSecret = readBakedEnv(process.env, { config }).GOOGLE_ANALYTICS_SECRET;

  return {
    // Core metadata
    runtime: 'browser-extension',
    version: project.version,
    environment: Manager.getEnvironment(),
    buildTime: Date.now(),

    // Brand configuration (from config/omega.json5 or manifest)
    brand: config.brand || {},

    // The local stack's resolved facts (N7). An extension context has no
    // env and no filesystem, so this bake is its ONLY channel: the sibling
    // backend's published map plus anything a parent injected on the env
    // channel, and the sibling WEBSITE's published origin
    // ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)) —
    // resolved per build so a rebuild follows a restarted emulator
    // ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)).
    // Production packages carry none — there is no local stack to reach.
    // A key present is a resolved fact; absent, @omega.js/client assumes the
    // classic and warns — so an unpublished origin ships no origin at all.
    ...(Manager.getEnvironment() === 'production'
      ? {}
      : { dev: {
        ports: { ...readSiblingPorts(rootPathProject), ...envPorts() },
        ...(devWebsiteOrigin ? { origin: devWebsiteOrigin } : {}),
      } }),

    // Cloud (firebase) config in the CANONICAL `cloud.config` shape —
    // what @omega.js/client prefers and the only shape background.js
    // reads. Without it the SW's Firebase auth never initializes (#46).
    cloud: config.cloud || {},

    // OMEGA build metadata
    omega: {
      environment: Manager.getEnvironment(),
      cache_breaker: Math.round(new Date().getTime() / 1000),
      // Resolved at serve time (N7) — the getter reads the allocator's
      // OMEGA_LIVERELOAD_PORT, so a bumped server and the baked client
      // agree. Packaged (non-serve) builds bake the classic default.
      liveReloadPort: config.liveReloadPort || Manager.getLiveReloadPort(),
    },

    // Web-manager features (matching expected structure)
    auth: { enabled: true, config: {} },

    firebase: {
      app: {
        enabled: !!(config.cloud?.config?.apiKey),
        config: config.cloud?.config || {},
      },
      appCheck: { enabled: false, config: {} },
    },

    consent: { enabled: true, config: {} },
    inbound: (() => {
      // Curated to the leaves the client runtime reads (#23) — the provisioning-only
      // siblings (template ids, plan, update flags) never ship in the bundle
      const chatsy = config.inbound?.chat?.providers?.chatsy;
      return { chat: { providers: { chatsy: chatsy
        ? { enabled: chatsy.enabled, agentId: chatsy.agentId, settings: chatsy.settings }
        : { enabled: false } } } };
    })(),
    sentry: {
      enabled: !!(sentryConfig.dsn),
      config: sentryConfig,
    },
    exitPopup: { enabled: false, config: {} },
    lazyLoading: { enabled: true, config: {} },
    socialSharing: { enabled: false, config: {} },
    pushNotifications: { enabled: false, config: {} },
    validRedirectHosts: [],
    refreshNewVersion: { enabled: true, config: {} },
    serviceWorker: { enabled: false, config: {} },

    // Analytics (canonical providers shape — C4 cp106a). The Measurement
    // Protocol API secret comes from .env (GOOGLE_ANALYTICS_SECRET —
    // matches @omega.js/backend/EM convention; secrets never live in
    // omega.json5) and is baked into the snapshot here at build time.
    analytics: {
      providers: {
        google: {
          id: googleAnalyticsId,
          secret: googleAnalyticsSecret,
        },
      },
    },

    // Theme config
    theme: config.theme || {},

    // Advertising (ads-system phase 4) — feeds the client verts module's
    // house/company lane (extension surfaces never run AdSense; lib/verts.js
    // pins the house type). company carries the parent's url so the
    // inhouse source 'company' can resolve.
    advertising: config.advertising || {},
    company: config.company || {},
  };
}

// OMEGA_BUILD_JSON itself — the build's own record of what it produced. The
// `license` stamp ([#320](https://github.com/Omega-JS-Stack/omega/issues/320))
// rides HERE and not inside `config`: it is a fact about the BUILD, not part of
// the client contract the extension contexts hand @omega.js/client. A packaged
// extension has no attribution surface and its payments ride the backend's own
// gate — this is the artifact's record of what it was packaged as.
async function composeBuildJson() {
  // Resolved ONCE per build: a PRODUCTION build asks the license server (a key
  // that cannot be answered THROWS, which is what gates a bad-key publish), and
  // a dev build is keyless by definition and never phones home. It used to be
  // memoized because packageRaw ran per browser target; one bundle pass bakes
  // the one snapshot every target then copies, so one call is the whole run.
  const license = await resolveLicenseStamp({ config, production: Manager.getEnvironment() === 'production' });

  // The verdict a run built under, said ONCE — web/backend/desktop all print theirs.
  logger.log(`bundling — environment=${Manager.getEnvironment()}, license=${license.status}`);

  return {
    timestamp: new Date().toISOString(),
    repo: getGitInfo(),
    environment: Manager.getEnvironment(),
    license,
    packages: {
      [frameworkPackage.name]: frameworkPackage.version,
      '@omega.js/client': getPackageVersion('@omega.js/client'),
    },
    config: composeBuildConfig(),
  };
}

/**
 * The compile-time replacement: a bare `OMEGA_BUILD_JSON` identifier becomes the
 * literal, so framework and consumer code can reference the snapshot without
 * reaching for a global.
 * @param {object} buildJson - The blob every bundle bakes.
 * @returns {object} an esbuild define map
 */
function buildJsonDefines(buildJson) {
  return {
    OMEGA_BUILD_JSON: JSON.stringify(buildJson),
    // webpack derived this from its `mode`; esbuild has no modes, so the
    // switch every bundled library reads is stated here instead. Dropping it
    // would ship every library's DEVELOPMENT branch to a store.
    'process.env.NODE_ENV': Manager.actLikeProduction() ? '"production"' : '"development"',
    // Libraries like lodash/@firebase/util reference the Node-ism `global`;
    // a browser bundle leaves it undefined, so it is rewritten textually.
    global: 'globalThis',
  };
}

/**
 * The global assignment every bundle carries, prepended ahead of its own code so
 * the snapshot is there before anything reads it — the load order the SW's
 * `importScripts('/build.js')` and the page template's `<script src="/build.js">`
 * used to buy. All three scopes are assigned because all three are read:
 * `serviceWorker.OMEGA_BUILD_JSON` in background.js, `window.OMEGA_BUILD_JSON`
 * in every page context, and `globalThis` from DevTools and consumer code.
 * @param {object} buildJson - The blob every bundle bakes.
 * @returns {object} an esbuild banner
 */
function buildJsonBanner(buildJson) {
  const literal = JSON.stringify(buildJson);
  return {
    js: `(function(){var __omegaBuildJson=${literal};if(typeof globalThis!=='undefined'){globalThis.OMEGA_BUILD_JSON=__omegaBuildJson;}if(typeof self!=='undefined'){self.OMEGA_BUILD_JSON=__omegaBuildJson;}if(typeof window!=='undefined'){window.OMEGA_BUILD_JSON=__omegaBuildJson;}})();`,
  };
}

// The keys the env schema says this build writes INTO the shipped artifact
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)): a packaged
// extension runs with no `.env`, so a `delivery: { extension: 'bake' }` key is
// read from the build env here and baked into the bundles. The list is the
// schema's — the hardcoded GOOGLE_ANALYTICS_SECRET read this replaced was one of
// three hand-kept lists for one concern.
const BAKED_KEYS = bakeKeys('extension');

/**
 * The schema's presence rules at the BAKE seam
 * ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)) — the last
 * moment a missing key is still fixable.
 *
 * A packaged extension runs with no `.env`, so what the bake holds is what the
 * artifact holds forever: a brand with a GA4 stream id and no Measurement
 * Protocol secret used to bake an empty string and ship an extension that sends
 * no events, silently — #582's failure mode, and the CI publish that has no
 * `.env` at all is exactly where it happens. A BUILD refuses; development
 * warns and keeps going, because a half-configured brand is a normal step on
 * the way to a configured one.
 *
 * @param {object} config - The target's resolved omega.json5 config.
 * @param {object} env - The build env.
 * @param {object} [options]
 * @param {boolean} [options.build] - Build/publish mode (default: the Manager's).
 * @param {object} [options.logger] - Logger with `warn` (default: this task's).
 * @throws {Error} in build mode, naming every brand-level key and the config path that requires it.
 */
function assertBakeRules(config, env, options) {
  options = options || {};
  const build = options.build === undefined ? Manager.isBuildMode() : options.build;
  const warn = (options.logger || logger).warn.bind(options.logger || logger);

  const violations = checkEnvRules(config, env, { target: 'extension' })
    .filter((violation) => violation.rule === 'requiredWhen');
  if (violations.length === 0) return;

  // The BRAND-LEVEL key name (GOOGLE_ANALYTICS_SECRET_EXTENSION, not the
  // GOOGLE_ANALYTICS_SECRET it is delivered as): that is the name a human puts
  // in the brand .env and in the repo's Actions secrets.
  const named = violations.map(({ key, path }) => `${key} (required by ${path})`).join(', ');
  const message = `${violations.length} env ${violations.length === 1 ? 'key this brand\'s config requires is' : 'keys this brand\'s config requires are'} missing from the build env: ${named}. `
    + 'Set it in the brand .env (and as a repo Actions secret for a CI publish — `omega deploy` pushes them), then build again.';

  if (build) {
    throw new Error(message);
  }

  warn(message);
}

// The baked keys' values from the build env. Absent reads as the empty string,
// never undefined: the snapshot is JSON, and a missing key would read to the
// client as "no analytics configured" rather than "configured, no secret".
//
// The presence guard runs FIRST: a build that would bake an empty secret over a
// configured stream refuses here rather than shipping the hole.
function readBakedEnv(env, options) {
  env = env || process.env;

  if (options && options.config) {
    assertBakeRules(options.config, env, options);
  }

  return Object.fromEntries(BAKED_KEYS.map((key) => [key, env[key] || '']));
}

// Get git info
function getGitInfo() {
  try {
    const { execSync } = require('child_process');
    const user = execSync('git config user.name', { encoding: 'utf8' }).trim();
    const repo = execSync('git config --get remote.origin.url', { encoding: 'utf8' })
      .trim()
      .replace(/.*[\/:]([\w-]+)\/([\w-]+)(\.git)?$/, '$2');

    return { user, name: repo };
  } catch (e) {
    return { user: 'unknown', name: 'unknown' };
  }
}

// Get package version
function getPackageVersion(packageName) {
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`, {
      paths: [process.cwd()]
    });
    const pkg = require(pkgPath);
    return pkg.version;
  } catch (e) {
    return 'unknown';
  }
}

// Task
function bundleTask(complete) {
  // Log
  logger.log('Starting...');
  Manager.logMemory(logger, 'Start');
  logger.log(`Mode: ${Manager.actLikeProduction() ? 'production' : 'development'}`);
  logger.log(`Target: ${SYNTAX_TARGET.join(', ')}`);

  runBundle()
    .then(() => {
      // Log
      logger.log('Finished!');

      // Trigger rebuild
      Manager.triggerRebuild(compiled);

      // Complete successfully
      return complete();
    })
    // esbuild rejects with every error already formatted, so a failed build
    // surfaces through the same reporter webpack's did.
    .catch((e) => Manager.reportBuildError(Object.assign(e, { plugin: 'Bundle' }), complete));
}

// Watcher task
function bundleWatcher(complete) {
  // Quit if in build mode
  if (Manager.isBuildMode()) {
    watcherLogger.log('Skipping watcher in build mode');
    return complete();
  }

  // Log
  watcherLogger.log('Watching for changes...');

  // Watch for changes
  watch(watchInput, { delay: delay, dot: true }, bundleTask)
  .on('change', (path) => {
    // Log
    watcherLogger.log(`File changed (${path})`);
  });

  // Complete
  return complete();
}

function updateEntryPoints(inputArray) {
  // Get all JS files
  const files = glob(inputArray).map((f) => path.resolve(f));

  // Sort: main files first
  files.sort((a, b) => {
    const aIsMain = a.startsWith(rootPathPackage);
    const bIsMain = b.startsWith(rootPathPackage);
    return aIsMain === bIsMain ? 0 : aIsMain ? -1 : 1;
  });

  // Update from src
  const entries = files.reduce((acc, file) => {
    let name;

    // Determine naming based on file type
    if (file.includes('/assets/js/bundles/')) {
      // Bundle files: bundles/my-bundle.js -> bundles/my-bundle
      name = file.split('/assets/js/')[1];
    } else if (file.includes('/assets/js/components/')) {
      // Component files: special handling for pages vs other components
      // Pages can have multiple files (index, pricing, login, etc.)
      // Other components (popup, options, etc.) only have index
      const componentPath = file.split('/assets/js/')[1];
      const isInPages = componentPath.includes('/pages/');

      if (componentPath.endsWith('/index.js') && !isInPages) {
        // For non-pages components: strip /index.js
        // components/popup/index.js -> components/popup
        const parts = componentPath.split('/');
        parts.pop(); // remove index.js
        name = parts.join('/');
      } else {
        // For pages or non-index files: keep full path
        // components/pages/index.js -> components/pages/index
        // components/pages/pricing.js -> components/pages/pricing
        name = componentPath.replace(/\.js$/, '');
      }
    } else if (file.includes('/assets/js/pages/')) {
      // Page files: keep full path
      name = file.split('/assets/js/')[1].replace(/\.js$/, '');
    } else {
      // Everything else: just use the base filename
      name = path.basename(file);
      name = name.replace(/\.js$/, '');
    }

    // Track the full output path
    const fullPath = path.resolve(process.cwd(), 'dist/assets/js', `${name}.bundle.js`);
    compiled[fullPath] = true;

    // Update entry points
    acc[`${name}.bundle`] = file;

    // Return
    return acc;
  }, {});

  // Log
  logger.log('Updated entry points:', entries);
  return entries;
}

function getTemplateReplaceOptions() {
  // Setup options
  const options = {
    // App & Project
    ...project,
    ...manifest,
    ...config,

    // Additional
    environment: Manager.getEnvironment(),

    // Specific
    firebaseVersion: version.clean(require('@omega.js/client/package.json').dependencies.firebase),
    liveReloadPort: Manager.getLiveReloadPort(),
  }

  // Return
  return options;
}

// Default Task
module.exports = series(bundleTask, bundleWatcher);

// The syntax floor and the browser Node-builtin shim list — pinned by
// src/test/suites/build/bundle-targets.test.js. The `%%%key%%%` pass and the
// replacement set — pinned by src/test/suites/build/template-replace.test.js.
module.exports.BROWSER_EMPTY_MODULES = BROWSER_EMPTY_MODULES;
module.exports.SYNTAX_TARGET = SYNTAX_TARGET;
module.exports.resolveSyntaxTarget = resolveSyntaxTarget;
module.exports.substituteTemplates = substituteTemplates;
module.exports.getTemplateReplaceOptions = getTemplateReplaceOptions;
// The OMEGA_BUILD_JSON bake (#743) — pinned by
// src/test/suites/build/build-json-bake.test.js and auth-emulator-gate.test.js.
// `bundleTask` is exported so that suite can drive the REAL build and read the
// bake back out of the files it emitted, rather than a stand-in esbuild call.
module.exports.bundleTask = bundleTask;
module.exports.composeBuildConfig = composeBuildConfig;
module.exports.composeBuildJson = composeBuildJson;
module.exports.buildJsonDefines = buildJsonDefines;
module.exports.buildJsonBanner = buildJsonBanner;
// The schema-derived bake set and its reader (#627).
module.exports.BAKED_KEYS = BAKED_KEYS;
module.exports.readBakedEnv = readBakedEnv;
