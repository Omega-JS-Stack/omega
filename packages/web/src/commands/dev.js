/**
 * `omega dev` — the development loop:
 *   1. dev-mode assets (stable un-hashed names, no minify) → .omega/manifest
 *   2. programmatic Eleventy watch + serve over src/
 *   3. asset-source watchers (consumer src/assets + packaged theme/core
 *      layers) rebuild bundles IN PLACE — URLs are stable in dev, so the
 *      rendered HTML stays valid without a re-render; refresh to pick up.
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
const { buildAssets } = require('../assets.js');
const { resolveStaticDirs, copyStaticAssets } = require('../static-assets.js');
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

  const activeTheme = (siteData.theme && siteData.theme.id) || 'classy';
  const themeLayerDirs = resolveThemeLayers({ activeTheme, consumerDir: paths.root, themesDir: PATHS.themes });
  const layers = [
    ...(fs.existsSync(paths.assets) ? [paths.assets] : []),
    ...themeLayerDirs,
    PATHS.core,
  ];

  // ---- Fresh output + dev assets
  fs.rmSync(paths.out, { recursive: true, force: true });

  const build = () => buildAssets({
    layers,
    themeRoots: themeLayerDirs,
    themesDir: PATHS.themes,
    coreDir: PATHS.core,
    outDir: paths.out,
    clientEntry,
    dev: true,
  });

  const manifest = await build();
  jetpack.write(paths.manifest, JSON.stringify(manifest, null, 2));
  logger.log('Assets built (dev mode: stable names, no minify)');

  // Static images (minted brand identity + src/assets/images) — copied once
  // at boot; they change rarely, so no watcher (restart to pick up new ones)
  copyStaticAssets({
    staticDirs: resolveStaticDirs({
      brandRoot: findBrandRoot(paths.root),
      imagesDir: path.join(paths.assets, 'images'),
    }),
    outDir: paths.out,
  });

  // ---- Rebuild assets in place on source changes
  const watchDirs = [
    paths.assets,
    ...themeLayerDirs,
    path.join(PATHS.core, 'js'),
    path.join(PATHS.core, 'css'),
  ].filter((dir) => fs.existsSync(dir));

  let timer = null;
  for (const dir of watchDirs) {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        build()
          .then(() => logger.log('Assets rebuilt — refresh the browser'))
          .catch((error) => logger.error('Asset rebuild failed:', error));
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // ---- Eleventy watch + serve
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(paths.src, paths.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      // Dev never runs the responsive image matrix — this middleware
      // rewrites missing -NNNpx/.webp variant URLs to the verbatim original,
      // so build-time `@srcset` markup resolves in dev too
      eleventyConfig.setServerOptions({ middleware: [devImageFallback(paths.out)] });
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
  elev.serve(port);

  // Publish the resolved website port for sibling tools (same contract as the
  // backend emulator's ports file) and retract it on shutdown.
  writePortsFile(paths.root, { website: port });
  process.on('exit', () => clearPortsFile(paths.root));
  process.on('SIGINT', () => process.exit(0));

  if (bumped) {
    logger.log(`Port ${CLASSIC_PORTS.website} was taken — bumped to ${port}`);
  }
  logger.log(`Dev server: http://localhost:${port}`);
};

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
