/**
 * The `boot` driver: Chrome with the project's built extension loaded unpacked.
 * A suite without `view` runs here, in the runner process, each case with
 * `ctx.extension` and a fresh `ctx.page`; a suite with `view: '<name>'` runs
 * inside `views/<name>/index.html` of the same loaded extension.
 */

const path  = require('path');
const fs    = require('fs');
const expect = require('@omega.js/devkit/test/expect');
const { runSuite } = require('@omega.js/devkit/test/run-case');
const { specKey } = require('@omega.js/devkit/test/serialize');
const { reportEvery } = require('@omega.js/devkit/test/events');
const { loadPuppeteer, launchChrome, waitForTarget } = require('./helpers.js');
const { runAppSuite, inPage } = require('./chromium.js');

// Why a loaded Chrome shows no extension target at all.
const NOT_LOADED = [
  'Chrome loaded but no chrome-extension target appeared: the extension failed to load. Common reasons:',
  'manifest.json misses a required field (manifest_version: 3);',
  'default_locale is set but _locales/<locale>/messages.json is missing;',
  '__MSG_*__ placeholders are used without default_locale and _locales/;',
  'a referenced file (background.service_worker, content_scripts) is not on disk.',
].join(' ');

/**
 * Locate the Chrome-loadable build of the consumer extension. The gulp pipeline
 * produces multiple outputs:
 *   - `dist/`                         — intermediate (JSON5 manifest, raw bundles)
 *   - `packaged/<browser>/raw/`       — per-browser, strict JSON manifest, Chrome-loadable
 *   - `packaged/<browser>/<name>.zip` — store-upload zip
 *
 * Boot tests run against `packaged/chrome/raw/` because that's the directory a
 * developer would point Chrome's "Load unpacked" at (and what zips for the Web
 * Store). It's the actual production-equivalent surface.
 *
 * Discovery order:
 *   1. OMEGA_TEST_BOOT_DIR (explicit absolute path) — full override
 *   2. <projectRoot>/packaged/chrome/raw   : default for consumers
 *   3. <projectRoot>/dist                    — for non-standard pipelines
 *
 * A directory qualifies only when its manifest is STRICT JSON — what Chrome can
 * actually parse. Existence alone used to qualify, and `dist/` exists after any
 * dev run or `omega clean`, so an unbuilt project loaded the JSON5 source
 * manifest and hard-failed every boot test instead of skipping as documented
 * ([#575](https://github.com/Omega-JS-Stack/omega/issues/575)). An explicitly
 * NAMED directory is not a fallback, so a JSON5 manifest there is still an error.
 *
 * The framework's own boot tests use the fixture extension under
 * src/test/fixtures/consumer-extension/dist (no `packaged/` step — the fixture
 * is already strict JSON), so OMEGA_TEST_BOOT_PROJECT points there and discovery
 * lands on `dist`.
 *
 * @param {string} projectRoot - the consumer project root (OMEGA_TEST_BOOT_PROJECT wins)
 * @returns {{effectiveRoot: string, dir: string|null, manifestPath: string|null, candidates: string[], rejected: object[], error: Error|null, errorPath: string|null}}
 */
function resolveBootDir(projectRoot) {
  const effectiveRoot = process.env.OMEGA_TEST_BOOT_PROJECT
    ? path.resolve(process.env.OMEGA_TEST_BOOT_PROJECT)
    : projectRoot;

  const override = process.env.OMEGA_TEST_BOOT_DIR ? path.resolve(process.env.OMEGA_TEST_BOOT_DIR) : null;

  const candidates = [];
  if (override) candidates.push(override);
  candidates.push(path.join(effectiveRoot, 'packaged', 'chrome', 'raw'));
  candidates.push(path.join(effectiveRoot, 'dist'));

  const rejected = [];

  for (const dir of candidates) {
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      if (dir === override) {
        return { effectiveRoot, dir: null, manifestPath: null, candidates, rejected, error: e, errorPath: manifestPath };
      }
      rejected.push({ dir, manifestPath, error: e });
      continue;
    }

    return { effectiveRoot, dir, manifestPath, candidates, rejected, error: null, errorPath: null };
  }

  return { effectiveRoot, dir: null, manifestPath: null, candidates, rejected, error: null, errorPath: null };
}

/**
 * Why the boot layer cannot run, or null when it can.
 * @param {object} discovery - resolveBootDir()'s result.
 * @returns {{skip?: string, error?: Error}|null} A skip reason, a failure, or null.
 */
function bootBlocker(discovery) {
  // An explicitly named OMEGA_TEST_BOOT_DIR is a decision, not a fallback: a broken manifest there fails.
  if (discovery.error) {
    return { error: new Error(`${discovery.errorPath} is not strict JSON (Chrome refuses comments, trailing commas and single quotes: ${discovery.error.message}). OMEGA_TEST_BOOT_DIR names this directory: point it at a packaged/<browser>/raw/ output, or unset it and run \`npm run build\`.`) };
  }
  if (!discovery.dir) {
    const rejected = discovery.rejected.map((r) => `; ${r.manifestPath} is not strict JSON (the JSON5 source Chrome refuses)`).join('');
    return { skip: `no built extension: no strict-JSON manifest.json in ${discovery.candidates.join(', ')}${rejected}; run \`npm run build\` first` };
  }
  return null;
}

/**
 * The loaded extension, as every boot case sees it. Most MV3 extensions have a
 * service worker; one without still shows a chrome-extension target.
 * @param {object} browser - Puppeteer Browser.
 * @param {string} manifestPath - The loaded manifest.json.
 * @returns {Promise<{id: string, manifest: object, swTarget: object|null, popupUrl: string|null, optionsUrl: string|null}>}
 */
async function loadedExtension(browser, manifestPath) {
  const swTarget = await waitForTarget(browser, (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), 5000);
  const target = swTarget || browser.targets().find((t) => t.url().startsWith('chrome-extension://'));
  if (!target) throw new Error(NOT_LOADED);

  const id = target.url().split('/')[2];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const popupRel = (manifest.action && manifest.action.default_popup) || null;
  const optionsRel = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null;
  return {
    id,
    manifest,
    swTarget,
    popupUrl: popupRel ? `chrome-extension://${id}/${popupRel}` : null,
    optionsUrl: optionsRel ? `chrome-extension://${id}/${optionsRel}` : null,
  };
}

/**
 * Run the boot suites on one loaded extension: the host set first, each case
 * on its own page (closed once it reports), then each view suite in its built view.
 * @param {{browser: object, dir: string, extension: object, suites: object[], report: Function, pages: {close: Function, open: Function}}} options
 * @returns {Promise<void>}
 */
async function runBootSuites({ browser, dir, extension, suites, report, pages }) {
  for (const suite of suites.filter((s) => typeof specKey(s, 'view') !== 'string')) {
    await runSuite(suite, {
      expect,
      extras: async () => ({ extension, page: await pages.open() }),
      report: async (event) => {
        report(event);
        await pages.close();
      },
    });
  }

  for (const suite of suites.filter((s) => typeof specKey(s, 'view') === 'string')) {
    const name = specKey(suite, 'view');
    const view = path.join(dir, 'views', name, 'index.html');
    if (!fs.existsSync(view)) {
      reportEvery(suite.cases, report, { status: 'fail', error: new Error(`${suite.file}: the view "${name}" is not built (no ${view})`) });
      continue;
    }
    const url = `chrome-extension://${extension.id}/views/${name}/index.html`;
    await runAppSuite(suite, { layer: 'boot', report, evaluate: inPage(browser, url) });
  }
}

// One page at a time for the host cases: opening the next closes the last.
function pageSlot(browser) {
  let page = null;
  const close = async () => {
    const open = page;
    page = null;
    // A page the browser already lost has nothing left to close.
    if (open) await open.close().catch(() => {});
  };
  return {
    close,
    async open() {
      await close();
      page = await browser.newPage();
      return page;
    },
  };
}

const bootDriver = {
  /**
   * Load the project's built extension and run the boot row's suites on it.
   * @param {{projectRoot: string, suites: object[], report: Function}} options - The runner's driver options.
   * @returns {Promise<{finished: Promise<void>, stop: Function}>}
   */
  async start({ projectRoot, suites, report }) {
    const cases = suites.flatMap((suite) => suite.cases);
    const idle = { finished: Promise.resolve(), stop: async () => {} };

    const discovery = resolveBootDir(projectRoot);
    const blocker = bootBlocker(discovery);
    if (blocker && blocker.error) reportEvery(cases, report, { status: 'fail', error: blocker.error });
    if (blocker && blocker.skip) reportEvery(cases, report, { status: 'skip', reason: blocker.skip });
    if (blocker) return idle;

    const puppeteer = loadPuppeteer();
    if (!puppeteer) {
      reportEvery(cases, report, { status: 'skip', reason: 'puppeteer is not installed: the boot layer runs in Chrome' });
      return idle;
    }

    const browser = await launchChrome(puppeteer, discovery.dir);
    let extension;
    try {
      extension = await loadedExtension(browser, discovery.manifestPath);
    } catch (e) {
      await browser.close();
      throw e;
    }

    const pages = pageSlot(browser);
    const finished = runBootSuites({ browser, dir: discovery.dir, extension, suites, report, pages });
    return {
      finished,
      async stop() {
        await pages.close();
        await browser.close();
      },
    };
  },
};

module.exports = { bootDriver, resolveBootDir };

