/**
 * Eleventy CLI config — used by `npm run dev` (serve/watch). Production builds
 * go through src/build.js (which runs the asset pipeline first); this config
 * reads the manifest that build left behind.
 *
 * Dev-mode notes:
 * - layouts default to the symlink FARM (watchable); virtual templates capture
 *   content at config time and are used for production builds.
 * - HTTPS: the dev server supports it natively — set OMEGA_HTTPS_KEY/CERT to
 *   mkcert-generated files.
 */
const fs = require('node:fs');
const path = require('node:path');
const { configureOmega } = require('./src/omega-web.js');

const SPIKE = __dirname;
const ROOT = path.resolve(SPIKE, '..', '..');
const CORPUS = path.join(ROOT, 'spikes', 'bakeoff-shared', 'corpus');

module.exports = function (eleventyConfig) {
  const manifestPath = path.join(SPIKE, '.omega', 'asset-manifest.json');
  const assetManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : undefined;
  const siteData = JSON.parse(fs.readFileSync(path.join(CORPUS, 'site-data.json'), 'utf8'));

  configureOmega(eleventyConfig, {
    consumerDir: CORPUS,
    siteData,
    themesDir: path.join(SPIKE, 'themes'),
    coreDir: path.join(SPIKE, 'core'),
    defaultsDir: path.join(SPIKE, 'defaults'),
    activeTheme: process.env.OMEGA_THEME,
    layoutMode: process.env.OMEGA_LAYOUT_MODE || 'farm',
    farmDir: path.join(SPIKE, '.omega', 'layout-farm'),
    assetManifest,
  });

  eleventyConfig.addWatchTarget('./themes/');

  if (process.env.OMEGA_HTTPS_KEY && process.env.OMEGA_HTTPS_CERT) {
    eleventyConfig.setServerOptions({
      https: { key: process.env.OMEGA_HTTPS_KEY, cert: process.env.OMEGA_HTTPS_CERT },
    });
  }

  return {
    dir: {
      input: path.relative(process.cwd(), CORPUS),
      output: path.relative(process.cwd(), path.join(SPIKE, '_site')),
    },
  };
};
