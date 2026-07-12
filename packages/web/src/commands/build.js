/**
 * `omega build` — full production build: assets (esbuild + sass, hashed) →
 * Eleventy → PurgeCSS, into dist/. The asset manifest also lands in
 * .omega/asset-manifest.json for the dev config and post-build tooling.
 * When translation.languages is set, the built site is then translated into
 * /{lang}/ copies (committed per-string cache; page failures warn, they
 * don't fail the build — `omega translate` standalone is strict).
 */
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');
const { buildSite } = require('../build.js');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { resolveClientEntry } = require('../paths.js');
const { translateSite } = require('../translate/index.js');

const logger = new Logger('omega:build');

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);

  // C2: payment.products is the only pricing source — surface the honest
  // empty state loudly so a bare catalog is a choice, not a surprise
  if (!siteData.payment || !Array.isArray(siteData.payment.products) || siteData.payment.products.length === 0) {
    logger.warn('payment.products is empty — /pricing renders the "no published pricing" empty state');
  }

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

  // Post-build translation (site.* IS the resolved config shape)
  const translation = await translateSite({
    root: paths.root,
    outDir: paths.out,
    config: siteData,
    logger,
    only: process.env.OMEGA_TRANSLATE_ONLY,
  });

  if (!translation.skipped) {
    logger.log(`Translated ${translation.pages} pages → ${translation.languages.join(', ')} (${translation.newStrings} new, ${translation.cachedStrings} cached strings)`);
    translation.failures.forEach((failure) => logger.warn(`translation: ${failure}`));
  }

  return result;
};
