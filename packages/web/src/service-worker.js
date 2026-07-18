/**
 * Service-worker build step + build-meta emission (the master-service-worker
 * successor's plumbing half; the browser half lives in sw/manager.js).
 *
 * Every build — dev included — emits to the site root:
 *   /service-worker.js  - esbuild iife bundle of the consumer's
 *                         src/service-worker.js (or the packaged default
 *                         entry), registered by @omega.js/client at scope '/'
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
const esbuild = require('esbuild');

// Fallback when @omega.js/client's package.json can't be resolved from the
// clientEntry path — keep in step with packages/client's firebase dependency.
const FIREBASE_VERSION_FALLBACK = '12.14.0';

/**
 * The firebase compat CDN version the SW imports — pinned to
 * @omega.js/client's own firebase dependency so page and worker agree.
 * @param {string} clientEntry - path to the client entry (walked up to its package.json)
 * @returns {string}
 */
function resolveFirebaseVersion(clientEntry) {
  let dir = clientEntry ? path.dirname(clientEntry) : null;
  for (let hops = 0; dir && hops < 5; hops++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        const raw = (pkg.dependencies && pkg.dependencies.firebase) || '';
        const version = raw.replace(/^[^\d]*/, '');
        if (version) return version;
      } catch { /* fall through to the parent dir */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return FIREBASE_VERSION_FALLBACK;
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
    : path.resolve(__dirname, '..', 'sw', 'entry.js');

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: !options.dev,
    // Classic worker script — importScripts() only exists outside module workers
    format: 'iife',
    outfile: path.join(options.outDir, 'service-worker.js'),
    alias: { '@omega.js/web/service-worker': path.resolve(__dirname, '..', 'sw', 'manager.js') },
    logLevel: 'silent',
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
 * @param {string} [options.environment] - 'development' | 'production'
 * @param {string} [options.version] - the consumer package version
 * @param {object} [options.manifest] - buildAssets() manifest (main bundle
 *   URLs — consumed by the SW's cache warm, which is currently disabled
 *   behind its CACHE_WARMING_ENABLED flag; kept so a flag flip just works)
 * @returns {object} the emitted meta
 */
function writeBuildMeta(options) {
  const site = options.siteData || {};
  const now = new Date();
  const meta = {
    brand: site.brand?.id || 'default',
    name: site.brand?.name || site.brand?.id || 'default',
    environment: options.environment || 'development',
    version: options.version || '0.0.0',
    // `timestamp` is the key @omega.js/client's version check reads
    timestamp: now.toISOString(),
    buildTime: now.toISOString(),
    cacheBreaker: now.getTime(),
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
