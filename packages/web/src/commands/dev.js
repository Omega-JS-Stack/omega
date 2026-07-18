/**
 * `omega dev` — the development loop:
 *   1. dev-mode assets (stable un-hashed names, no minify) → .omega/manifest
 *   2. programmatic Eleventy watch + serve over src/
 *   3. asset-source watchers (consumer src/assets + packaged theme/core
 *      layers) rebuild bundles IN PLACE — URLs are stable in dev, so the
 *      rendered HTML stays valid without a re-render; the dev server
 *      watches the built asset trees and live-reloads the browser (css
 *      hot-swaps, js reloads — no hand refresh).
 *
 * Port (N7): the website convention is 4000, resolved through the allocator —
 * taken ports bump +1. `omega dev --port=4001` (or a config `ports.website`
 * entry) PINS the port instead: busy = hard error, never a silent bump. The
 * resolved map of a live sibling backend (its `.temp/ports.json`) plus this
 * website port are injected into the page chrome as `dev.ports` so
 * @omega.js/client connects to the stack that is ACTUALLY running.
 *
 * `omega dev --local` first links every @omega.js framework the brand uses to
 * the local Omega monorepo (file: installs, idempotent) and starts the
 * monorepo's src→dist watch, then runs the normal dev loop (master plan §8).
 */
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const {
  CLASSIC_PORTS, isPortFree, resolvePorts, envPort,
  readPortsFile, writePortsFile, clearPortsFile,
  findBrandRoot, hasOmegaConfig, loadConfig,
} = require('@omega.js/config');
const { emitIcons } = require('@omega.js/devkit/icons');
const { buildAssets } = require('../assets.js');
const { buildServiceWorker, writeBuildMeta } = require('../service-worker.js');
const { resolveStaticDirs, copyStaticAssets, hasFaviconSet } = require('../static-assets.js');
const { devImageFallback } = require('../imagemin.js');
const { configureOmega } = require('../engine.js');
const { resolveThemeLayers } = require('../layers.js');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { PATHS, resolveClientEntry } = require('../paths.js');

const logger = new Logger('omega:dev');

const WATCH_DEBOUNCE_MS = 250;

module.exports = async function (options) {
  options = options || {};

  if (options.local) {
    await linkBrandToMonorepo();
  }

  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);
  const clientEntry = resolveClientEntry();
  const { port, bumped } = await resolveWebsitePort(paths.root, Number(options.port) || null);
  const devPorts = { ...readSiblingPorts(paths.root), website: port };

  // HTTPS (same contract as the backend's serve/emulator): the PUBLIC website
  // port speaks TLS through the shared mkcert proxy; eleventy sits on an
  // internal plain-http port behind it (WebSocket live-reload tunnels through).
  // `--no-https` or no mkcert → plain http on the public port, as before.
  const { ensureLocalHttpsCerts, startLocalHttpsProxy } = require('@omega.js/devkit/local-https');
  let httpsCerts = null;
  let internalPort = null;
  if (options.https !== false) {
    httpsCerts = await ensureLocalHttpsCerts({
      certsDir: path.join(paths.root, '.temp', 'certs'),
      log: (line) => logger.log(line),
    });

    if (httpsCerts) {
      ({ ports: { internal: internalPort } } = await resolvePorts({ wanted: { internal: 4443 } }));
    } else {
      logger.log('HTTPS disabled — could not obtain certificates (install mkcert: brew install mkcert && mkcert -install)');
    }
  }

  applyDevSiteUrl(siteData, port, httpsCerts !== null);

  const activeTheme = (siteData.theme && siteData.theme.id) || 'classy';
  const themeLayerDirs = resolveThemeLayers({ activeTheme, consumerDir: paths.root, themesDir: PATHS.themes });
  const layers = [
    ...(fs.existsSync(paths.assets) ? [paths.assets] : []),
    ...themeLayerDirs,
    PATHS.core,
  ];

  // ---- Fresh output + dev assets
  fs.rmSync(paths.out, { recursive: true, force: true });

  const build = (only) => buildAssets({
    layers,
    themeRoots: themeLayerDirs,
    themesDir: PATHS.themes,
    coreDir: PATHS.core,
    outDir: paths.out,
    clientEntry,
    dev: true,
    only,
  });

  // Static images (minted brand identity + src/assets/images) resolve up
  // front — the manifest's favicon flag depends on what will ship
  const staticDirs = resolveStaticDirs({
    brandRoot: findBrandRoot(paths.root),
    imagesDir: path.join(paths.assets, 'images'),
  });

  const manifest = await build();
  manifest.favicons = hasFaviconSet(staticDirs);
  jetpack.write(paths.manifest, JSON.stringify(manifest, null, 2));
  logger.log('Assets built (dev mode: stable names, no minify)');

  // ---- Service worker + build meta (/service-worker.js, /build.js,
  // /build.json) — dev serves the REAL service worker so push/caching are
  // testable; registration takeover + cache eviction keep one localhost
  // port safe across different projects.
  const buildSw = async () => {
    writeBuildMeta({
      siteData,
      outDir: paths.out,
      environment: 'development',
      version: jetpack.read(path.join(paths.root, 'package.json'), 'json')?.version,
      manifest,
    });
    await buildServiceWorker({
      consumerDir: paths.src,
      outDir: paths.out,
      clientEntry,
      dev: true,
    });
  };
  await buildSw();

  // Copied once at boot; they change rarely, so no watcher (restart to pick
  // up new ones)
  copyStaticAssets({
    staticDirs,
    outDir: paths.out,
  });

  // Runtime icon set (/assets/fa/) — the browser-side auto-renderer fetches
  // these on demand (JS-set fa-* markup, e.g. the share buttons); emitted once
  // at boot like the statics (the set never changes mid-dev).
  emitIcons({
    outDir: paths.out,
    coreIconsDir: path.join(PATHS.core, 'icons'),
  });

  // ---- Rebuild assets in place on source changes
  const watchDirs = [
    paths.assets,
    ...themeLayerDirs,
    path.join(PATHS.core, 'js'),
    path.join(PATHS.core, 'css'),
  ].filter((dir) => fs.existsSync(dir));

  // Narrowed rebuilds: a css-only change set rebuilds just the stylesheets —
  // no js files are rewritten, so the dev server HOT-SWAPS the css without a
  // page reload. js changes rebuild js (full reload — scripts need one), and
  // an unknown/mixed set rebuilds everything.
  let timer = null;
  let pendingKinds = new Set();
  const kindOf = (file) => {
    if (/\.(scss|css)$/.test(file || '')) return 'css';
    if (/\.(js|mjs)$/.test(file || '')) return 'js';
    return 'other';
  };
  for (const dir of watchDirs) {
    fs.watch(dir, { recursive: true }, (event, file) => {
      pendingKinds.add(kindOf(file));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const kinds = pendingKinds;
        pendingKinds = new Set();
        const only = kinds.size === 1 && !kinds.has('other') ? kinds.values().next().value : undefined;
        build(only)
          .then(() => logger.log(`Assets rebuilt (${only || 'all'}) — browser live-reloads${only === 'css' ? ' via css hot-swap' : ''}`))
          .catch((error) => logger.error('Asset rebuild failed:', error));
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // The consumer's service-worker entry lives OUTSIDE the asset trees
  // (src/service-worker.js) — its own watcher; the browser picks the new
  // worker up on the next reload's registration update check.
  const consumerSwEntry = path.join(paths.src, 'service-worker.js');
  if (fs.existsSync(consumerSwEntry)) {
    let swTimer = null;
    fs.watch(consumerSwEntry, () => {
      clearTimeout(swTimer);
      swTimer = setTimeout(() => {
        buildSw()
          .then(() => logger.log('Service worker rebuilt — reload to activate the new worker'))
          .catch((error) => logger.error('Service worker rebuild failed:', error));
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // ---- Eleventy watch + serve
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(paths.src, paths.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setServerOptions(devServerOptions(paths.out));
      return configureOmega(eleventyConfig, {
        consumerDir: paths.src,
        siteData,
        activeTheme,
        assetManifest: manifest,
        environment: 'development',
        dev: { ports: devPorts },
      });
    },
  });

  await elev.init();
  await elev.watch();
  elev.serve(httpsCerts ? internalPort : port);

  // TLS terminator on the public port → eleventy on the internal one
  if (httpsCerts) {
    startLocalHttpsProxy({
      port,
      targetPort: internalPort,
      certs: httpsCerts,
      log: (line) => logger.log(line),
    });
  }

  // Publish the resolved website port for sibling tools (same contract as the
  // backend emulator's ports file) and retract it on shutdown. The PUBLIC
  // port is the published one — the internal eleventy port is plumbing.
  writePortsFile(paths.root, { website: port });
  process.on('exit', () => clearPortsFile(paths.root));
  process.on('SIGINT', () => process.exit(0));

  if (bumped) {
    logger.log(`Port ${CLASSIC_PORTS.website} was taken — bumped to ${port}`);
  }
  logger.log(`Dev server: ${httpsCerts ? 'https' : 'http'}://localhost:${port}`);
};

/**
 * Dev-server options: the image-variant fallback middleware (dev never runs
 * the responsive matrix — missing -NNNpx/.webp URLs rewrite to the verbatim
 * original) + live-reload on ASSET rebuilds. Eleventy's dev server only
 * reloads on its own template re-renders; our asset watcher writes bundles
 * straight into the out dir, so the server chokidars those trees too — css
 * changes hot-swap without a full reload, js changes reload the page. Kills
 * the "refresh the browser" hand step.
 * @param {string} outDir
 * @returns {object} setServerOptions() payload
 */
function devServerOptions(outDir) {
  return {
    middleware: [devCleanUrls(outDir), devImageFallback(outDir)],
    watch: [
      path.join(outDir, 'assets', 'css'),
      path.join(outDir, 'assets', 'js'),
    ],
  };
}

/**
 * Clean-URL resolution, the legacy serve.js contract: pages are flat `.html`
 * files with slash-free URLs, so `/signin` (and a stray `/signin/`) serves
 * `signin.html`. Mirrors production GitHub Pages, which resolves extensionless
 * paths against `.html` files natively.
 * @param {string} outDir
 * @returns {function} connect-style middleware
 */
function devCleanUrls(outDir) {
  const root = path.resolve(outDir);

  return (req, res, next) => {
    const [pathname, query] = (req.url || '').split('?');
    const clean = decodeURIComponent(pathname).replace(/\/+$/, '');

    if (!clean) {
      return next();
    }

    // Legacy serve.js contract: rewrite only when the request doesn't hit a
    // real file but `<path>.html` exists. No extension sniffing — dotted
    // slugs (/updates/v1.0.0) are page URLs too.
    const original = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const resolved = path.resolve(root, `.${clean}.html`);
    if (
      resolved.startsWith(root + path.sep)
      && jetpack.exists(original) !== 'file'
      && jetpack.exists(resolved) === 'file'
    ) {
      req.url = `${clean}.html${query ? `?${query}` : ''}`;
    }

    return next();
  };
}

/**
 * Dev builds link to THIS server, never the live site (legacy _config_dev.yml
 * url-override parity): site.url is the one root every absolute-URL surface
 * derives from — canonicals/og tags, uj_external, absolute_url, redirect
 * pages, nav — so pointing it at the local origin keeps every click in dev.
 * @param {object} siteData - the loaded site global (mutated)
 * @param {number} port - the resolved dev-server port
 * @param {boolean} [https] - whether the public port speaks TLS (mkcert proxy)
 */
function applyDevSiteUrl(siteData, port, https) {
  siteData.url = `${https ? 'https' : 'http'}://localhost:${port}`;
}

/**
 * Resolve the website port through the allocator (N7). An explicit `--port`
 * flag or a config `ports.website` entry PINS the port (busy = hard error);
 * otherwise start from OMEGA_WEBSITE_PORT (a parent that already allocated)
 * or the classic 4000 and bump +1 while taken.
 */
async function resolveWebsitePort(root, flagPort) {
  const pins = {};

  if (flagPort) {
    if (!(await isPortFree(flagPort))) {
      throw new Error(`Port ${flagPort} (pinned via --port) is already in use — free it or pick another`);
    }
    pins.website = flagPort;
  } else {
    const configPin = loadPortPins(root).website;
    if (typeof configPin === 'number') {
      pins.website = configPin;
    }
  }

  const wanted = { website: envPort('website') || CLASSIC_PORTS.website };
  const { ports, bumped } = await resolvePorts({ wanted, pins });
  return { port: ports.website, bumped: bumped.length > 0 };
}

/**
 * Read explicit port pins from the consumer's config `ports` section.
 * Lenient — a missing/broken config means no pins, never a dev-loop failure.
 */
function loadPortPins(root) {
  try {
    if (!hasOmegaConfig(root)) {
      return {};
    }
    const config = loadConfig(root, 'web').config;
    return config.ports && typeof config.ports === 'object' ? config.ports : {};
  } catch (error) {
    return {};
  }
}

/**
 * Merge the live ports files of sibling apps in the same brand (a running
 * backend's resolved emulator map). Dead-pid leftovers are ignored by
 * readPortsFile; our own app dir is skipped (a previous run of THIS server).
 * No brand root (standalone consumer) → empty map, client falls back to the
 * classic ports.
 */
function readSiblingPorts(root) {
  const brandRoot = findBrandRoot(root);
  if (!brandRoot) {
    return {};
  }

  const appsDir = path.join(brandRoot, 'apps');
  const merged = {};

  for (const entry of fs.existsSync(appsDir) ? fs.readdirSync(appsDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const appDir = path.join(appsDir, entry.name);
    if (path.resolve(appDir) === path.resolve(root)) {
      continue;
    }
    Object.assign(merged, readPortsFile(appDir) || {});
  }

  return merged;
}

/**
 * `--local` prelude: file:-install every @omega.js framework used anywhere in
 * this brand (all apps, walked up from cwd) from the local Omega monorepo,
 * then start the monorepo's src→dist watch as a session-scoped child.
 */
// Exposed for tests (the command function stays the main export)
module.exports.resolveWebsitePort = resolveWebsitePort;
module.exports.readSiblingPorts = readSiblingPorts;
module.exports.devServerOptions = devServerOptions;
module.exports.applyDevSiteUrl = applyDevSiteUrl;

async function linkBrandToMonorepo() {
  const local = require('@omega.js/devkit/local');
  const monorepoRoot = local.resolveMonorepoRoot();
  const brandRoot = local.findBrandRoot(process.cwd());
  logger.log(`Local mode: linking @omega.js packages from ${monorepoRoot}`);

  for (const appDir of local.discoverApps(brandRoot)) {
    await local.linkLocalPackages({ dir: appDir, monorepoRoot, logger });
  }

  const watch = local.startMonorepoWatch({ monorepoRoot, logger });
  if (watch.child) {
    // Session-scoped: the watch dies with this dev server (no orphans)
    process.on('SIGINT', () => {
      watch.child.kill('SIGTERM');
      process.exit(0);
    });
    process.on('exit', () => watch.child.kill('SIGTERM'));
  }
}
