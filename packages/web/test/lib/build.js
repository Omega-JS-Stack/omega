/**
 * Shared mini-fixture builder for web integration tests — runs Eleventy over
 * test/fixtures/mini-site with injected site data and indexes rendered pages
 * by URL. Callers pass a `name` so each test file gets its own output +
 * layout-farm directories (node --test runs files concurrently).
 */
const fs = require('node:fs');
const path = require('node:path');

// Determinism pin: anchor sample-content rolling dates to the corpus epoch
// so generated dates ≡ authored dates — fixture builds and golden snapshots
// stay stable across days. Tests that PROVE rolling pass an explicit
// sampleAnchor option (it outranks the env pin).
process.env.OMEGA_SAMPLE_ANCHOR = process.env.OMEGA_SAMPLE_ANCHOR || '2026-07-18';

const { configureOmega } = require('../../src/index.js');

const PKG = path.resolve(__dirname, '..', '..');
const MINI = path.join(PKG, 'test', 'fixtures', 'mini-site');
const BARE = path.join(PKG, 'test', 'fixtures', 'bare-site');

/**
 * Build a fixture site with a given siteData and index results by URL.
 * @param {string} inputDir - fixture dir (Eleventy input / consumerDir)
 * @param {object} siteData - resolved-config-shaped site data
 * @param {object} [overrides] - configureOmega option overrides
 * @param {string} [name] - namespace for this caller's .omega output dirs
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildSite(inputDir, siteData, overrides = {}, name = 'site-build') {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(inputDir, path.join(PKG, '.omega', `${name}-out`), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: inputDir,
        siteData,
        farmDir: path.join(PKG, '.omega', `${name}-farm`),
        assetManifest: {
          js: {
            main: '/assets/js/main-TEST.js',
            firstPaint: '/assets/js/first-paint-TEST.js',
            pages: {},
            // The one layout asset the framework ships (#624) — every redirect
            // page's hop rides it, so the fixture manifest carries it.
            layouts: { 'modules/utilities/redirect': ['/assets/js/layouts/modules/utilities/redirect-TEST.js'] },
          },
          css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
          // The head's font-preload loop reads the manifest (#765) — one
          // fixture face, so every render carries the link the real lane emits.
          fontPreloads: ['/assets/fonts/preload-TEST.woff2'],
        },
        ...overrides,
      });
    },
  });
  const results = await elev.toJSON();
  // Only the pages that SHIP. A framework page the consumer took over, or a
  // sample the brand's own content replaced, is registered and gated at render
  // time (#200 Lane B) — it writes no file, which Eleventy reports as `url:
  // false`, and a build's product is the files it wrote.
  return new Map(results.filter((r) => typeof r.url === 'string').map((r) => [r.url, r.content]));
}

/**
 * Build the mini fixture with a given siteData and index results by URL.
 * @param {object} siteData - resolved-config-shaped site data
 * @param {object} [overrides] - configureOmega option overrides
 * @param {string} [name] - namespace for this caller's .omega output dirs
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
function buildWith(siteData, overrides = {}, name = 'mini-build') {
  return buildSite(MINI, siteData, overrides, name);
}

const miniData = JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8'));

module.exports = { buildSite, buildWith, miniData, MINI, BARE, PKG };
