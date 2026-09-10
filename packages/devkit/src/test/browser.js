/**
 * The headless browser every e2e lane drives — resolved from the BRAND ROOT,
 * launched with one set of args.
 *
 * A brand installs nothing for this. `@omega.js/manager` carries puppeteer and
 * every brand root installs the manager, so the Chrome a lane drives is the
 * one hoisted beside that dependency — which is why the resolution walks up to
 * the manifest DECLARING the manager rather than requiring from wherever the
 * lane file happens to sit (a lane under `test/e2e/` of a target, or of the
 * brand, resolves the same browser either way). With no such manifest above it
 * — this monorepo's own root lanes — the NEAREST manifest above the caller
 * answers, and node's own resolution climbs from there to whatever install
 * hoisted puppeteer.
 *
 * The launch args are the lane contract, not preference: `--no-sandbox` +
 * `--disable-dev-shm-usage` are what make a CI container's Chrome start at
 * all, and `--ignore-certificate-errors` is what lets a page load the local
 * stack's mkcert HTTPS origin without a per-machine trust store.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// The dependency that identifies a BRAND root — every brand installs it.
const BRAND_DEPENDENCY = '@omega.js/manager';

const LAUNCH_ARGS = [
  '--ignore-certificate-errors',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

/**
 * The directory puppeteer resolves from: the nearest package.json declaring
 * @omega.js/manager, else the NEAREST package.json above `fromDir`.
 *
 * The fallback is the nearest and never the outermost, because resolution only
 * needs a starting point node can climb from: from the nearest manifest it
 * reaches every install above it, while jumping to the outermost would skip
 * the nearer copy a nested install deliberately put there.
 *
 * @param {string} [fromDir] - Directory to walk up from (default: cwd)
 * @returns {string|null} The resolved root, or null when no manifest exists
 */
function puppeteerRoot(fromDir) {
  let dir = path.resolve(fromDir || process.cwd());
  let nearest = null;

  while (true) {
    const manifestPath = path.join(dir, 'package.json');
    if (fs.existsSync(manifestPath)) {
      if (nearest === null) nearest = dir;
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        manifest = null; // an unreadable manifest is not a brand root, keep walking
      }
      const declares = manifest && ['dependencies', 'devDependencies', 'peerDependencies']
        .some((field) => manifest[field] && manifest[field][BRAND_DEPENDENCY]);
      if (declares) {
        return dir;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return nearest;
    }
    dir = parent;
  }
}

/**
 * The brand root's puppeteer, with its Chrome proved present.
 *
 * THROWS rather than degrading: a lane that cannot launch a browser has to
 * decide for itself whether that is a skip (the monorepo's own lanes print one
 * line and exit 0) or a failure — this module never decides it for them.
 *
 * @param {string} [fromDir] - Directory to walk up from (default: cwd)
 * @returns {object} The puppeteer module
 */
function resolvePuppeteer(fromDir) {
  const root = puppeteerRoot(fromDir);
  if (!root) {
    throw new Error(`no package.json above ${path.resolve(fromDir || process.cwd())} — puppeteer cannot be resolved`);
  }

  let puppeteer;
  try {
    puppeteer = createRequire(path.join(root, 'package.json'))('puppeteer');
  } catch (error) {
    throw new Error(`puppeteer is not installed at ${root} (${BRAND_DEPENDENCY} carries it — run npm install)`);
  }

  const chrome = puppeteer.executablePath();
  if (!chrome || !fs.existsSync(chrome)) {
    throw new Error(`puppeteer's Chrome is not installed at ${chrome} — run \`npx puppeteer browsers install chrome\``);
  }

  return puppeteer;
}

/**
 * Launch the lane's browser.
 *
 * @param {object} [options]
 * @param {string} [options.from] - Directory to resolve puppeteer from (default: cwd)
 * @param {string[]} [options.args] - Extra Chrome args, appended to LAUNCH_ARGS
 * @param {object} [options.puppeteer] - A resolved puppeteer (the test seam)
 * @param {...*} [options.rest] - Forwarded to puppeteer.launch()
 * @returns {Promise<object>} The puppeteer browser
 */
function launchBrowser(options = {}) {
  const { from, args = [], puppeteer, ...launchOptions } = options;
  const driver = puppeteer || resolvePuppeteer(from);

  return driver.launch({
    headless: true,
    ...launchOptions,
    args: [...LAUNCH_ARGS, ...args],
  });
}

module.exports = { launchBrowser, resolvePuppeteer, puppeteerRoot, LAUNCH_ARGS, BRAND_DEPENDENCY };
