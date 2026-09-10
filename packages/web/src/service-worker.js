/**
 * Service-worker build step + build-meta emission (the master-service-worker
 * successor's plumbing half; the browser half lives in sw/manager.js).
 *
 * Every build — dev included — emits to the site root:
 *   /service-worker.js  - esbuild iife bundle of the consumer's
 *                         src/service-worker.js (or the packaged default
 *                         entry), registered by @omega.js/client at scope '/'
 *                         (at scope '<prefix>/' when the site is mounted
 *                         under a base path — #360)
 *   /build.js           - `self.OMEGA_BUILD_JSON = {…}` — the SW's config
 *                         transport (importScripts can't consume JSON)
 *   /build.json         - the same meta for page-side consumers
 *                         (@omega.js/client's version check fetches it)
 *
 * The meta carries brand id + cacheBreaker, so the SW's cache name
 * (`<brand>-<breaker>`) identifies the owning project+build — the takeover
 * mechanism for one localhost port serving different projects over time.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { brandRepoName, brandRepoOwner } = require('@omega.js/config');
const { bundle } = require('@omega.js/devkit/bundle');
const { getEnvironment } = require('./mode-helpers.js');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..');

// Fallback when @omega.js/client's package.json can't be resolved from the
// clientEntry path — keep in step with packages/client's firebase dependency.
const FIREBASE_VERSION_FALLBACK = '12.14.0';

/**
 * The nearest readable package.json walking up from `dir`.
 * @param {string} dir - where to start (a file's dirname, or a dir)
 * @param {number} [hops] - how far up to walk
 * @returns {object|null} the parsed manifest, or null when none is readable
 */
function readPackageUp(dir, hops = 5) {
  let at = dir || null;
  for (let hop = 0; at && hop < hops; hop++) {
    const candidate = path.join(at, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch { /* unreadable — keep walking */ }
    }
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return null;
}

/**
 * The firebase compat CDN version the SW imports — pinned to
 * @omega.js/client's own firebase dependency so page and worker agree.
 * @param {string} clientEntry - path to the client entry (walked up to its package.json)
 * @returns {string}
 */
function resolveFirebaseVersion(clientEntry) {
  const pkg = readPackageUp(clientEntry ? path.dirname(clientEntry) : null);
  const version = (pkg?.dependencies?.firebase || '').replace(/^[^\d]*/, '');

  return version || FIREBASE_VERSION_FALLBACK;
}

/**
 * The versions the built site is actually made of — the framework doing the
 * building, the client runtime it embeds, that runtime's firebase, and the
 * node it all ran on. Read from the resolved package manifests, never a
 * hardcoded list, so a locally linked checkout reports its own version.
 *
 * @param {string} [clientEntry] - @omega.js/client entry
 * @returns {object} name → version
 */
function packageVersions(clientEntry) {
  const web = readPackageUp(__dirname);
  const client = readPackageUp(clientEntry ? path.dirname(clientEntry) : null);
  const versions = {};

  if (web?.name && web.version) versions[web.name] = web.version;
  if (client?.name && client.version) versions[client.name] = client.version;
  versions.firebase = resolveFirebaseVersion(clientEntry);
  versions.node = process.version.replace(/^v/, '');

  return versions;
}

/**
 * The commit the site was built from — `git rev-parse` in the consumer tree.
 * An absent repo is an EXPECTED external condition (a tarball, a CI checkout
 * with no .git, a brand that never ran `git init`), so this answers null
 * rather than failing a build over it.
 *
 * @param {string} [consumerDir] - anywhere inside the consumer's repo
 * @returns {string|null} the short sha, or null when there is no repo
 */
function resolveCommit(consumerDir) {
  if (!consumerDir) {
    return null;
  }

  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Bundle the service worker to `<outDir>/service-worker.js`.
 * @param {object} options
 * @param {string} options.consumerDir - the consumer site src (holds an optional service-worker.js)
 * @param {string} options.outDir - the site output dir
 * @param {string} [options.clientEntry] - @omega.js/client entry (firebase version source)
 * @param {boolean} [options.dev] - dev mode: no minify
 * @returns {Promise<string>} the service worker URL ('/service-worker.js')
 */
async function buildServiceWorker(options) {
  const consumerEntry = path.join(options.consumerDir, 'service-worker.js');
  const entry = fs.existsSync(consumerEntry)
    ? consumerEntry
    : path.resolve(FRAMEWORK_ROOT, 'sw', 'entry.js');

  // The ONE esbuild wrapper (#736/#737): @omega.js/devkit composes the minify
  // rule and the production `@dev-only` strip this call used to spell out by
  // hand. `outfile` (#737) is why it can — the worker must land at exactly
  // `/service-worker.js`, the scope @omega.js/client registers.
  await bundle({
    frameworkRoot: FRAMEWORK_ROOT,
    entries: [entry],
    dev: Boolean(options.dev),
    // Classic worker script — importScripts() only exists outside module workers
    format: 'iife',
    outfile: path.join(options.outDir, 'service-worker.js'),
    alias: { '@omega.js/web/service-worker': path.resolve(FRAMEWORK_ROOT, 'sw', 'manager.js') },
    define: {
      'process.env.NODE_ENV': options.dev ? '"development"' : '"production"',
      __OMEGA_FIREBASE_VERSION__: JSON.stringify(resolveFirebaseVersion(options.clientEntry)),
    },
  });

  return '/service-worker.js';
}

/**
 * Emit /build.js (JSONP for the SW) + /build.json (page-side) into outDir.
 * @param {object} options
 * @param {object} options.siteData - resolved omega config (brand/cloud)
 * @param {string} options.outDir
 * @param {string} [options.environment] - the build's environment (#717, read through the one surface)
 * @param {string} [options.version] - the consumer package version
 * @param {object} [options.manifest] - buildAssets() manifest (main bundle
 *   URLs — consumed by the SW's cache warm, which is currently disabled
 *   behind its CACHE_WARMING_ENABLED flag; kept so a flag flip just works)
 * @param {string} [options.consumerDir] - the consumer site src (the commit lookup's cwd)
 * @param {string} [options.clientEntry] - @omega.js/client entry (version source)
 * @returns {object} the emitted meta
 */
function writeBuildMeta(options) {
  const site = options.siteData || {};
  const now = new Date();
  const owner = brandRepoOwner(site);
  const repo = brandRepoName(site);
  const meta = {
    brand: site.brand?.id || 'default',
    name: site.brand?.name || site.brand?.id || 'default',
    environment: getEnvironment.call(options),
    version: options.version || '0.0.0',
    // `timestamp` is the key @omega.js/client's version check reads
    timestamp: now.toISOString(),
    buildTime: now.toISOString(),
    cacheBreaker: now.getTime(),
    // The rest of the manifest the /status page shows (#13): what skin the
    // site wears, what it is made of, where it lives, and which commit it came
    // from. All derived at build time — nothing here is authored twice.
    theme: site.theme?.id || null,
    packages: packageVersions(options.clientEntry),
    repo: owner && repo ? { user: owner, name: repo } : null,
    commit: resolveCommit(options.consumerDir),
    assets: {
      js: options.manifest?.js?.main || null,
      css: options.manifest?.css?.main || null,
    },
    firebase: site.cloud?.config || null,
  };

  fs.mkdirSync(options.outDir, { recursive: true });
  fs.writeFileSync(path.join(options.outDir, 'build.json'), `${JSON.stringify(meta, null, 2)}\n`);
  fs.writeFileSync(path.join(options.outDir, 'build.js'), `self.OMEGA_BUILD_JSON = ${JSON.stringify(meta)};\n`);

  return meta;
}

module.exports = { buildServiceWorker, writeBuildMeta, resolveFirebaseVersion };
