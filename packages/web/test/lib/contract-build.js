/**
 * Contract-suite theme builds, one CHILD PROCESS per theme (#179).
 *
 * Eleventy's layout cache (`@11ty/eleventy/src/LayoutCache.js`) is a MODULE
 * singleton keyed by input dir + layout key, and it outlives the Eleventy
 * instance that filled it. Three themes built from the SAME fixture dir in one
 * process therefore share one set of cached TemplateLayout objects: the first
 * theme's layouts render every later theme's pages. A fresh process per theme
 * is isolation that reaches into no Eleventy internals, and it builds each
 * theme exactly the way a consumer does: one process, one site.
 *
 * This file is both halves: required, it forks; forked, it builds.
 */
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const PKG = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(PKG, '..', '..');
const SITE = path.join(PKG, 'test', 'fixtures', 'contract-site');

/**
 * Output dir of a theme's contract build.
 * @param {string} theme
 * @returns {string}
 */
function themeOutDir(theme) {
  return path.join(PKG, '.omega', `contract-${theme}`);
}

/**
 * Build the contract fixture on one theme, in its own process.
 * @param {string} theme
 * @returns {Promise<object>} the buildSite result (timings, htmlCount, manifest)
 */
function buildTheme(theme) {
  return new Promise((resolve, reject) => {
    // stdout is dropped (Eleventy's per-build summary line); stderr is
    // inherited so a failing build reports its real stack.
    const child = fork(__filename, [theme], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let result = null;
    child.on('message', (message) => { result = message; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && result) return resolve(result);
      reject(new Error(`contract build failed for ${theme} (exit ${code})`));
    });
  });
}

// The forked half: build the named theme and hand the result back.
if (require.main === module) {
  const { buildSite } = require('../../src/build.js');
  const siteData = JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8'));
  const theme = process.argv[2];
  buildSite({
    consumerDir: SITE,
    siteData: { ...siteData, theme: { id: theme } },
    outDir: themeOutDir(theme),
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    skipPurge: true, // purge is pinned in assets.test.js; contract pins rendering
  }).then((result) => process.send(result));
}

module.exports = { buildTheme, themeOutDir, SITE, PKG };
