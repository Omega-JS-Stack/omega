/**
 * `omega dev` — the development loop:
 *   1. dev-mode assets (stable un-hashed names, no minify) → .omega/manifest
 *   2. programmatic Eleventy watch + serve over src/
 *   3. asset-source watchers (consumer src/assets + packaged theme/core
 *      layers) rebuild bundles IN PLACE — URLs are stable in dev, so the
 *      rendered HTML stays valid without a re-render; refresh to pick up.
 *
 * `omega dev --port=4000` overrides the default port.
 *
 * `omega dev --local` first links every @omega.js framework the brand uses to
 * the local Omega monorepo (file: installs, idempotent) and starts the
 * monorepo's src→dist watch, then runs the normal dev loop (master plan §8).
 */
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const { buildAssets } = require('../assets.js');
const { configureOmega } = require('../engine.js');
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
  const port = Number(options.port) || 8080;

  const activeTheme = (siteData.theme && siteData.theme.id) || 'classy';
  const themeLayerDirs = [...new Set([activeTheme, 'classy'])].map((id) => path.join(PATHS.themes, id));
  const layers = [
    ...(fs.existsSync(paths.assets) ? [paths.assets] : []),
    ...themeLayerDirs,
    PATHS.core,
  ];

  // ---- Fresh output + dev assets
  fs.rmSync(paths.out, { recursive: true, force: true });

  const build = () => buildAssets({
    layers,
    themesDir: PATHS.themes,
    coreDir: PATHS.core,
    outDir: paths.out,
    clientEntry,
    dev: true,
  });

  const manifest = await build();
  jetpack.write(paths.manifest, JSON.stringify(manifest, null, 2));
  logger.log('Assets built (dev mode: stable names, no minify)');

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
    config: (eleventyConfig) =>
      configureOmega(eleventyConfig, {
        consumerDir: paths.src,
        siteData,
        activeTheme,
        assetManifest: manifest,
        environment: 'development',
      }),
  });

  await elev.init();
  await elev.watch();
  elev.serve(port);
  logger.log(`Dev server: http://localhost:${port}`);
};

/**
 * `--local` prelude: file:-install every @omega.js framework used anywhere in
 * this brand (all apps, walked up from cwd) from the local Omega monorepo,
 * then start the monorepo's src→dist watch as a session-scoped child.
 */
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
