// Boot-runner — spawns Chromium with the consumer's actual built `dist/` loaded
// as an unpacked extension, runs `inspect` functions against the live extension,
// then closes cleanly.
//
// Differences from runners/chromium.js:
//   - chromium.js spawns the harness extension and tests BXM's framework surface.
//   - boot.js spawns the CONSUMER'S `dist/` (their real production extension) and
//     verifies it boots end-to-end: manifest is valid, SW starts, popup loads, etc.
//
// Why both? `background` + `view` layers cover framework / lib code fast. `boot`
// layer covers integration — does the consumer's actual extension boot with their
// real manifest + brand config + scaffolds? Replaces shell-level smoke tests.
//
// `inspect` functions receive { extension, page, expect, projectRoot } where:
//   extension.id        — the loaded extension's chrome-extension://<id>
//   extension.manifest  — parsed manifest.json
//   extension.popupUrl  — chrome-extension://<id>/<action.default_popup>
//   extension.optionsUrl— chrome-extension://<id>/<options_ui.page>
//   extension.swTarget  — Puppeteer ServiceWorker target (may be null)
//   page                — Puppeteer Page (fresh per test; popup not auto-loaded)
//   projectRoot         — absolute path to the consumer project root
//   expect              — same Jest-compatible expect() as build/background/view

const path  = require('path');
const fs    = require('fs');
const { waitForTarget } = require('./helpers.js');
const chalk = require('chalk').default;

/**
 * Locate the Chrome-loadable build of the consumer extension. The gulp pipeline
 * produces multiple outputs:
 *   - `dist/`                         — intermediate (JSON5 manifest, raw bundles)
 *   - `packaged/<browser>/raw/`       — per-browser, strict JSON manifest, Chrome-loadable
 *   - `packaged/<browser>/<name>.zip` — store-upload zip
 *
 * Boot tests run against `packaged/chromium/raw/` because that's the directory a
 * developer would point Chrome's "Load unpacked" at (and what zips for the Web
 * Store). It's the actual production-equivalent surface.
 *
 * Discovery order:
 *   1. OMEGA_TEST_BOOT_DIR (explicit absolute path) — full override
 *   2. <projectRoot>/packaged/chromium/raw   — default for consumers
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
  candidates.push(path.join(effectiveRoot, 'packaged', 'chromium', 'raw'));
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

async function runBootTests({ tests, projectRoot, frameworkDistRoot, defaultTimeout }) {
  if (tests.length === 0) return { passed: 0, failed: 0, skipped: 0 };

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.log(chalk.yellow(`    ○ boot tests skipped (puppeteer not installed)`));
    return { passed: 0, failed: 0, skipped: tests.length };
  }

  const discovery = resolveBootDir(projectRoot);

  // An explicitly named OMEGA_TEST_BOOT_DIR whose manifest Chrome cannot parse
  // is the caller's own mistake — name it, fail the tests.
  if (discovery.error) {
    console.log(chalk.red(`    ✗ boot tests aborted: ${discovery.errorPath} is not strict JSON.`));
    console.log(chalk.gray(`      Chrome requires manifest.json to have no comments, no trailing commas, no single quotes.`));
    console.log(chalk.gray(`      Parser error: ${discovery.error.message}`));
    console.log(chalk.gray(`      OMEGA_TEST_BOOT_DIR names this directory explicitly — point it at a`));
    console.log(chalk.gray(`      packaged/<browser>/raw/ output, or unset it and run \`npm run build\`.`));
    return { passed: 0, failed: tests.length, skipped: 0 };
  }

  if (!discovery.dir) {
    console.log(chalk.yellow(`    ○ boot tests skipped (no strict-JSON manifest.json found in any of:`));
    for (const c of discovery.candidates) console.log(chalk.yellow(`        ${c}`));
    for (const r of discovery.rejected) console.log(chalk.yellow(`      ${r.manifestPath} exists but is not strict JSON (the intermediate JSON5 source Chrome refuses)`));
    console.log(chalk.yellow(`      — run \`npm run build\` first to produce packaged/chromium/raw/)`));
    return { passed: 0, failed: 0, skipped: tests.length };
  }

  const consumerDist = discovery.dir;
  const manifestPath = discovery.manifestPath;

  if (process.env.OMEGA_TEST_DEBUG) {
    console.log(chalk.gray(`      [boot] loading extension from ${consumerDist}`));
  }

  const expect = require('../assert.js');
  const counts = { passed: 0, failed: 0, skipped: 0 };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${consumerDist}`,
      `--load-extension=${consumerDist}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    // Discover the loaded extension. Most consumer extensions have an MV3 SW
    // — wait up to 5s for it. If the consumer extension is service-worker-less
    // (rare in MV3 but allowed for action-only extensions), we still get the
    // chrome-extension://<id> via browser targets and the manifest gives us
    // the popup URL.
    const swTarget = await waitForTarget(browser, (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), 5000);

    let extId;
    let manifest;
    if (swTarget) {
      extId = swTarget.url().split('/')[2];
    } else {
      // No SW — find any chrome-extension target.
      const anyExtTarget = browser.targets().find((t) => t.url().startsWith('chrome-extension://'));
      if (!anyExtTarget) {
        console.log(chalk.red(`    ✗ Boot aborted — Chromium loaded but no chrome-extension target appeared.`));
        console.log(chalk.gray(`      Likely cause: the extension failed to load. Common reasons:`));
        console.log(chalk.gray(`        - manifest.json missing required field (e.g. manifest_version: 3)`));
        console.log(chalk.gray(`        - default_locale is set but _locales/<locale>/messages.json is missing`));
        console.log(chalk.gray(`        - __MSG_*__ placeholders used without default_locale + _locales/`));
        console.log(chalk.gray(`        - referenced files (background.service_worker, content_scripts) don't exist on disk`));
        return { passed: 0, failed: tests.length, skipped: 0 };
      }
      extId = anyExtTarget.url().split('/')[2];
    }
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.log(chalk.red(`    ✗ Boot aborted — failed to parse manifest: ${e.message}`));
      return { passed: 0, failed: tests.length, skipped: 0 };
    }

    const popupRel   = (manifest.action && manifest.action.default_popup) || null;
    const optionsRel = (manifest.options_ui && manifest.options_ui.page)  || (manifest.options_page || null);

    const extension = {
      id:         extId,
      manifest,
      swTarget,
      popupUrl:   popupRel   ? `chrome-extension://${extId}/${popupRel}`   : null,
      optionsUrl: optionsRel ? `chrome-extension://${extId}/${optionsRel}` : null,
    };

    for (const t of tests) {
      const start = Date.now();
      const page = await browser.newPage();
      try {
        await Promise.race([
          t.inspect({ extension, page, expect, projectRoot: discovery.effectiveRoot }),
          // The runner resolves every test's timeout before it gets here
          // (its bootDefaultTimeout); `defaultTimeout` is the same number for a
          // caller driving this runner directly, so the number lives in ONE
          // place — test/runner.js's BOOT_DEFAULT_TIMEOUT (#262).
          new Promise((_, reject) => setTimeout(() => reject(new Error('Boot test timeout')), t.timeout || defaultTimeout)),
        ]);
        const duration = Date.now() - start;
        console.log(chalk.green(`      ✓ ${t.description}`) + chalk.gray(` (${duration}ms)`));
        counts.passed += 1;
      } catch (e) {
        const duration = Date.now() - start;
        console.log(chalk.red(`      ✗ ${t.description}`) + chalk.gray(` (${duration}ms)`));
        console.log(chalk.red(`        ${(e && e.message) || String(e)}`));
        counts.failed += 1;
      } finally {
        try { await page.close(); } catch (_) { /* ignore */ }
      }
    }
  } finally {
    try { await browser.close(); } catch (_) { /* ignore */ }
  }

  return counts;
}

module.exports = { runBootTests, resolveBootDir };
