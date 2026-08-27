/**
 * `omega build` — full production build: assets (esbuild + sass, hashed) →
 * Eleventy → PurgeCSS, into dist/. The asset manifest also lands in
 * .omega/asset-manifest.json for the dev config and post-build tooling.
 * When translation.languages is set, the built site is then translated into
 * /{lang}/ copies — cache-first (committed per-string cache), and cold
 * strings translate LIVE by default so a build always ships the complete
 * translated site (Ian's #24 final call). `omega build --cached-only` skips
 * cold pages instead (with a warning list) for LLM-free builds.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { findBrandRoot } = require('@omega.js/config');
const { buildSite } = require('../build.js');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { resolveStaticDirs } = require('../static-assets.js');
const { resolveClientEntry } = require('../paths.js');
const { translateSite } = require('../translate/index.js');
const { fetchFirebaseAuthHelpers } = require('../firebase-auth-helpers.js');
const { visibleProducts } = require('../pricing.js');

const logger = new Logger('omega:build');

/**
 * C2: payment.products is the only pricing source — surface the honest empty
 * state loudly so a bare catalog is a choice, not a surprise. The page composes
 * from the VISIBLE catalog (#348), so an all-hidden catalog renders the same
 * empty state and earns the same warning, named for what it actually is.
 * @param {object} payment - resolved config `payment` section
 * @returns {string|null} The warning to print, or null when /pricing has cards.
 */
function catalogWarning(payment) {
  if (visibleProducts(payment).length > 0) return null;

  const total = payment && Array.isArray(payment.products) ? payment.products.length : 0;
  const state = total > 0
    ? `payment.products lists ${total} product${total === 1 ? '' : 's'}, every one marked hidden`
    : 'payment.products is empty';

  return `${state} — /pricing renders the "no published pricing" empty state`;
}

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();

  // Tee the whole run to <targetRoot>/logs/build.log (#197). `omega test` runs this
  // build INSIDE its own logs/test.log tee and passes logFile: false — a second
  // attach would detach that tee and the rest of the run would go uncaptured.
  if (options.logFile !== false) {
    attachLogFile(path.join(paths.root, 'logs', 'build.log'));
  }

  const siteData = loadSiteData(paths.root);
  const brandRoot = findBrandRoot(paths.root);

  const emptyCatalog = catalogWarning(siteData.payment);
  if (emptyCatalog) {
    logger.warn(emptyCatalog);
  }

  const result = await buildSite({
    consumerDir: paths.src,
    siteAssetsDir: paths.assets,
    siteData,
    outDir: paths.out,
    clientEntry: resolveClientEntry(),
    environment: 'production',
    version: jetpack.read(path.join(paths.root, 'package.json'), 'json')?.version,
    manifestPath: paths.manifest,
    staticDirs: resolveStaticDirs({
      brandRoot,
      assetsDir: paths.assets,
    }),
    // Responsive image matrix (the UJM imagemin successor) — on unless the
    // brand opts out via `web.imagemin.enabled: false`. The cache is
    // machine-owned at the brand's .omega (never committed); CI restores it
    // via actions/cache in the scaffolded build workflow.
    imagemin: siteData.imagemin && siteData.imagemin.enabled === false ? null : {
      cacheDir: path.join(brandRoot || paths.root, '.omega', 'cache', 'imagemin'),
      log: (message) => logger.log(message),
    },
    onPhase: (name, seconds) => logger.log(`${name}: ${seconds.toFixed(2)}s`),
  });

  if (result.imagemin) {
    result.imagemin.warnings.forEach((warning) => logger.warn(`imagemin: ${warning} — shipped verbatim`));
  } else if (siteData.imagemin && siteData.imagemin.enabled === false) {
    logger.log('imagemin: disabled via web.imagemin.enabled — images ship verbatim');
  }

  logger.log(`Built ${result.htmlCount} pages in ${result.timings.total.toFixed(2)}s → ${path.relative(paths.root, paths.out)}/`);

  // A mounted build looks identical on disk and wrong at the domain root, so
  // say the base path out loud whenever OMEGA_PATH_PREFIX supplied one (#355).
  if (result.pathPrefix) {
    logger.log(`Base path: ${result.pathPrefix} — every emitted URL is mounted under it (OMEGA_PATH_PREFIX)`);
  }

  // GH Pages custom domain: every production build carries dist/CNAME so
  // BOTH deploy lanes publish it — the CI workflow passes no cname to its
  // gh-pages action, and a push without the file clears the Pages domain
  // (UJM auto-created it; omega parity).
  const cname = require('./deploy.js').pagesHost(siteData);
  if (cname) {
    jetpack.write(path.join(paths.out, 'CNAME'), cname);
  }

  // Self-host Firebase's /__/auth/* helper files so authDomain can be the
  // brand host on static hosting (translation excludes __/auth by design).
  // The fetch writes through to the brand's machine-owned cache (never
  // committed, same home as the imagemin cache) so an offline build serves
  // the last good copy instead of failing after emitting every page (#548).
  await fetchFirebaseAuthHelpers({
    siteData,
    outDir: paths.out,
    logger,
    cacheDir: path.join(brandRoot || paths.root, '.omega', 'cache', 'firebase-auth'),
  });

  // Post-build translation (site.* IS the resolved config shape).
  // Default: translate EVERYTHING — warm strings from the committed cache
  // (instant), cold strings live through the provider, so a build always
  // ships the complete translated site. --cached-only skips cold pages
  // instead (warning lists them) for provider-free builds.
  if (options.cachedOnly) {
    logger.log('--cached-only: cold pages will be skipped, not translated');
  }

  const translation = await translateSite({
    root: paths.root,
    outDir: paths.out,
    config: siteData,
    logger,
    only: process.env.OMEGA_TRANSLATE_ONLY,
    cachedOnly: Boolean(options.cachedOnly),
  });

  if (!translation.skipped) {
    logger.log(`Translated ${translation.pages} pages → ${translation.languages.join(', ')} (${translation.newStrings} new, ${translation.cachedStrings} cached strings)`);
    translation.failures.forEach((failure) => logger.warn(`translation: ${failure} — page skipped whole, no copy shipped`));

    if (translation.skippedCold.length) {
      const preview = translation.skippedCold.slice(0, 10).join(', ');
      const more = translation.skippedCold.length > 10 ? ` (+${translation.skippedCold.length - 10} more)` : '';
      logger.warn(`translation: ${translation.skippedCold.length} page-language pair(s) skipped — cold cache: ${preview}${more}`);
      logger.warn('translation: run `omega translate` (or build without --cached-only) to translate them');
    }
  }

  return result;
};

module.exports.catalogWarning = catalogWarning;
