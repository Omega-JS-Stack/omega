/**
 * Full production build orchestration — the seed of `omega build` (B3):
 * assets (esbuild page modules + layered sass) → Eleventy → PurgeCSS, with
 * per-phase timings returned for benches and CLIs. Consumer-agnostic: the
 * caller supplies the consumer dir + site data; framework content (themes,
 * core, default pages) defaults to what ships with the package.
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildAssets, purgeCss } = require('./assets.js');
const { configureOmega } = require('./engine.js');
const { emitIcons } = require('@omega.js/devkit/icons');
const { resolveThemeLayers } = require('./layers.js');
const { PATHS } = require('./paths.js');

/**
 * Build a consumer site end to end.
 * @param {object} options
 * @param {string} options.consumerDir - the consumer site (Eleventy input dir)
 * @param {object} options.siteData - raw site data (resolved omega config shape)
 * @param {string} options.outDir - output dir (cleared first)
 * @param {string} options.clientEntry - @omega.js/client entry for the `@omega.js/client` esbuild alias
 * @param {string} [options.siteAssetsDir] - the consumer's own asset layer (js/pages page modules)
 * @param {string} [options.themesDir] - default: packaged themes
 * @param {string} [options.coreDir] - default: packaged core
 * @param {string} [options.defaultsDir] - default: packaged default pages
 * @param {string} [options.activeTheme] - default: siteData.theme.id
 * @param {string} [options.layoutMode] - 'virtual' (default) or 'farm'
 * @param {string} [options.farmDir] - symlink-farm target (farm mode)
 * @param {boolean} [options.skipPurge] - skip the PurgeCSS pass
 * @param {string} [options.manifestPath] - also write the asset manifest here (the dev config reads it)
 * @param {function} [options.onPhase] - (name, seconds) callback after each phase
 * @returns {Promise<{ timings: object, htmlCount: number, manifest: object }>}
 */
async function buildSite(options) {
  const themesDir = options.themesDir || PATHS.themes;
  const coreDir = options.coreDir || PATHS.core;
  const defaultsDir = options.defaultsDir || PATHS.defaults;
  const activeTheme = options.activeTheme || (options.siteData.theme && options.siteData.theme.id) || 'classy';
  const themeLayerDirs = resolveThemeLayers({ activeTheme, consumerDir: options.consumerDir, themesDir });

  const timings = {};
  const started = process.hrtime.bigint();
  const phase = async (name, fn) => {
    const t0 = process.hrtime.bigint();
    const result = await fn();
    timings[name] = Number(process.hrtime.bigint() - t0) / 1e9;
    if (options.onPhase) options.onPhase(name, timings[name]);
    return result;
  };

  fs.rmSync(options.outDir, { recursive: true, force: true });

  // ---- assets first: the manifest feeds the head/foot includes
  const manifest = await phase('assets', () =>
    buildAssets({
      layers: [
        ...(options.siteAssetsDir ? [options.siteAssetsDir] : []),
        ...themeLayerDirs,
        coreDir,
      ],
      themeRoots: themeLayerDirs,
      themesDir,
      coreDir,
      outDir: options.outDir,
      clientEntry: options.clientEntry,
    })
  );
  if (options.manifestPath) {
    fs.mkdirSync(path.dirname(options.manifestPath), { recursive: true });
    fs.writeFileSync(options.manifestPath, JSON.stringify(manifest, null, 2));
  }

  // ---- runtime icon set (assets/fa/) — feeds the browser-side auto-render
  await phase('icons', () => emitIcons({
    outDir: options.outDir,
    coreIconsDir: path.join(coreDir, 'icons'),
  }));

  // ---- Eleventy
  await phase('eleventy', async () => {
    const Eleventy = require('@11ty/eleventy').default;
    const elev = new Eleventy(options.consumerDir, options.outDir, {
      quietMode: true,
      configPath: false,
      config: (eleventyConfig) =>
        configureOmega(eleventyConfig, {
          consumerDir: options.consumerDir,
          siteData: options.siteData,
          themesDir,
          coreDir,
          defaultsDir,
          activeTheme,
          layoutMode: options.layoutMode,
          farmDir: options.farmDir,
          assetManifest: manifest,
          environment: options.environment,
        }),
    });
    await elev.write();
  });

  // ---- PurgeCSS over the rendered HTML
  if (!options.skipPurge) {
    await phase('purge', () => purgeCss({ outDir: options.outDir, manifest }));
  }

  timings.total = Number(process.hrtime.bigint() - started) / 1e9;
  return { timings, htmlCount: countHtml(options.outDir), manifest };
}

/**
 * Count .html files under a directory.
 * @param {string} dir
 * @returns {number}
 */
function countHtml(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) count++;
  }
  return count;
}

module.exports = { buildSite };
