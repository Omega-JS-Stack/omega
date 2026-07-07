/**
 * `omega build` — full production build: assets (esbuild + sass, hashed) →
 * Eleventy → PurgeCSS, into dist/. The asset manifest also lands in
 * .omega/asset-manifest.json for the dev config and post-build tooling.
 */
const path = require('node:path');
const Logger = require('@omegajs/devkit/logger');
const { buildSite } = require('../build.js');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { resolveClientEntry } = require('../paths.js');

const logger = new Logger('omega:build');

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);

  const result = await buildSite({
    consumerDir: paths.src,
    siteAssetsDir: paths.assets,
    siteData,
    outDir: paths.out,
    clientEntry: resolveClientEntry(),
    environment: 'production',
    manifestPath: paths.manifest,
    onPhase: (name, seconds) => logger.log(`${name}: ${seconds.toFixed(2)}s`),
  });

  logger.log(`Built ${result.htmlCount} pages in ${result.timings.total.toFixed(2)}s → ${path.relative(paths.root, paths.out)}/`);
  return result;
};
