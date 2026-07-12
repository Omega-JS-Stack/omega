/**
 * Shared mini-fixture builder for web integration tests — runs Eleventy over
 * test/fixtures/mini-site with injected site data and indexes rendered pages
 * by URL. Callers pass a `name` so each test file gets its own output +
 * layout-farm directories (node --test runs files concurrently).
 */
const fs = require('node:fs');
const path = require('node:path');

const { configureOmega } = require('../../src/index.js');

const PKG = path.resolve(__dirname, '..', '..');
const MINI = path.join(PKG, 'test', 'fixtures', 'mini-site');

/**
 * Build the mini fixture with a given siteData and index results by URL.
 * @param {object} siteData - resolved-config-shaped site data
 * @param {object} [overrides] - configureOmega option overrides
 * @param {string} [name] - namespace for this caller's .omega output dirs
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildWith(siteData, overrides = {}, name = 'mini-build') {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(MINI, path.join(PKG, '.omega', `${name}-out`), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: MINI,
        siteData,
        farmDir: path.join(PKG, '.omega', `${name}-farm`),
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: {} },
          css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} },
        },
        ...overrides,
      });
    },
  });
  const results = await elev.toJSON();
  return new Map(results.map((r) => [r.url, r.content]));
}

const miniData = JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8'));

module.exports = { buildWith, miniData, MINI, PKG };
