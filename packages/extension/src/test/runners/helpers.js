/**
 * Shared helpers for the extension's Chrome drivers (chromium.js, boot.js):
 * puppeteer and the launch, and the target wait.
 */

/**
 * Puppeteer, or null when it is not installed (the layers that need it skip).
 * @returns {object|null} The puppeteer module.
 */
function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && /'puppeteer'/.test(e.message)) return null;
    throw e;
  }
}

/**
 * Launch headless Chrome with one unpacked extension loaded. MV3 workers
 * start only in the new headless mode.
 * @param {object} puppeteer - The puppeteer module.
 * @param {string} extensionDir - The directory holding the extension's manifest.json.
 * @returns {Promise<object>} The Puppeteer Browser.
 */
function launchChrome(puppeteer, extensionDir) {
  return puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

/**
 * Resolve a Puppeteer target matching predicate: existing targets first, then
 * `targetcreated` events, resolving null on timeout.
 * @param {object} browser - Puppeteer Browser
 * @param {(target: object) => boolean} predicate
 * @param {number} timeoutMs
 * @returns {Promise<object|null>}
 */
async function waitForTarget(browser, predicate, timeoutMs) {
  const found = browser.targets().find(predicate);
  if (found) return found;
  return new Promise((resolve) => {
    const done = (t) => { browser.off('targetcreated', handle); resolve(t); };
    const handle = (t) => { if (predicate(t)) done(t); };
    browser.on('targetcreated', handle);
    setTimeout(() => done(null), timeoutMs);
  });
}

module.exports = { loadPuppeteer, launchChrome, waitForTarget };
