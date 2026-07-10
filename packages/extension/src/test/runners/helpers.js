/**
 * Shared helpers for the extension test runners (boot.js + chromium.js).
 */

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

module.exports = { waitForTarget };
