/**
 * Shared mini-fixture builder for web integration tests — runs Eleventy over
 * test/fixtures/mini-site with injected site data and indexes rendered pages
 * by URL. Callers pass a `name` so each test file gets its own output +
 * layout-farm directories (node --test runs files concurrently).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Determinism pin: anchor sample-content rolling dates to the corpus epoch
// so generated dates ≡ authored dates — fixture builds and golden snapshots
// stay stable across days. Tests that PROVE rolling pass an explicit
// sampleAnchor option (it outranks the env pin).
process.env.OMEGA_SAMPLE_ANCHOR = process.env.OMEGA_SAMPLE_ANCHOR || '2026-07-18';

const { setEnvironment } = require('@omega.js/config/environment');
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
  // The lane NAMES the environment
  // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): `omega build`
  // names production and `omega dev` names development, and the engine reads
  // that ONE input instead of a loose `options.environment` of its own. This
  // harness is the lane for a fixture build, so it names one here. A fixture
  // that says nothing is a DEVELOPMENT build, which is what they have always
  // been; a case that names its own passes it through `overrides` as before.
  setEnvironment(overrides.environment || 'development');

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
  const outDir = path.join(PKG, '.omega', `${name}-out`);
  const results = await elev.toJSON();
  // Only the pages that SHIP. A framework page the consumer took over, or a
  // sample the brand's own content replaced, is registered and gated at render
  // time (#200 Lane B) — it writes no file, which Eleventy reports as `url:
  // false`, and a build's product is the files it wrote.
  const pages = new Map(results.filter((r) => typeof r.url === 'string').map((r) => [r.url, r.content]));

  // The build snapshot is a FILE the engine writes on its way into the run
  // (#743), served at `/build.js` like any other artifact, so it is indexed
  // under the URL a browser asks for it by, beside the pages that load it.
  const buildJs = path.join(outDir, 'build.js');
  if (fs.existsSync(buildJs)) pages.set('/build.js', fs.readFileSync(buildJs, 'utf8'));

  return pages;
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

/**
 * The OMEGA_BUILD_JSON wrapper a built site hands every context
 * ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)): the ONE
 * `build.js` at the site root, which the head loads with its first script tag
 * and the service worker with importScripts. RUN, not string-matched, the way a
 * browser resolves it: a Liquid or writer slip that emits unparseable JS fails
 * HERE rather than as a blank page in a browser.
 * @param {string} file - path of an emitted build.js
 * @returns {object} the parsed wrapper
 */
function readBuildJsFile(file) {
  return runBuildJs(fs.readFileSync(file, 'utf8'));
}

/**
 * Run a build.js in a worker-like scope and hand back what it assigned, as
 * plain data: the vm scope is another realm, so a JSON round trip is what makes
 * the result comparable with `assert.deepEqual` here.
 * @param {string} source - the file text
 * @returns {object} the wrapper
 */
function runBuildJs(source) {
  const scope = { self: {} };
  vm.runInNewContext(source, scope);

  return JSON.parse(JSON.stringify(scope.self.OMEGA_BUILD_JSON));
}

/**
 * The same wrapper, out of a fixture build's own emitted file.
 * @param {Map<string, string>} pages - url → content, as buildSite indexes it (it carries `/build.js`)
 * @returns {object|null} the parsed wrapper, or null when the build wrote none
 */
function readBuildJson(pages) {
  const source = pages.get('/build.js');

  return source ? runBuildJs(source) : null;
}

/**
 * The config a PAGE ends up with: the site's snapshot plus the page's own
 * `config:` delta, which head.html emits as one `Object.assign` line after the
 * loader tag (#607). A page with no block emits none and reads the site's.
 * @param {Map<string, string>} pages - the build's pages
 * @param {string} html - the rendered page
 * @returns {object} the config that page's runtime readers see
 */
function readPageConfig(pages, html) {
  const config = readBuildJson(pages)?.config;
  const delta = String(html || '').match(/Object\.assign\(self\.OMEGA_BUILD_JSON\.config,\s*(\{.*?\})\s*\);/s);

  // eslint-disable-next-line no-new-func
  return delta ? { ...config, ...new Function(`return ${delta[1]}`)() } : config;
}

const miniData = JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8'));

module.exports = { buildSite, buildWith, runBuildJs, readBuildJsFile, readBuildJson, readPageConfig, miniData, MINI, BARE, PKG };
