/**
 * The flows lane's "moment of doubt" for a session killed server-side: bring
 * an open, signed-in tab back into view until @omega.js/client's session probe
 * signs it out and the page's auth policy routes it to the auth surface.
 *
 * An inconclusive probe (a network error, a throttle, a failing Auth server)
 * keeps the user signed in by contract, so one dispatch under load can land on
 * "unknown" with nothing retrying. Like a real user, the tab comes back into
 * view every few seconds inside one ceiling. A failure names the probe's
 * verdict as the client's own probe log line reported it, read off the page
 * console, instead of a bare timeout.
 */

const CEILING_MS = 60000;
const CADENCE_MS = 5000;
const PROBE_LINE = /Session is gone|Session probe inconclusive/;

/**
 * Fire the tab's visibility moment, the one the client probes the session on.
 * @param {object} page - puppeteer page
 * @returns {Promise<void>}
 */
function comeBackIntoView(page) {
  return page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * Bring the tab back into view until it routes to /signin or /signup.
 * @param {object} page - puppeteer page, signed in on a policy page
 * @returns {Promise<string>} the auth-surface URL the tab landed on
 */
async function waitForSignOutAtDoubt(page) {
  let probeLine = null;
  const onConsole = (message) => {
    if (PROBE_LINE.test(message.text())) probeLine = message.text();
  };
  page.on('console', onConsole);

  try {
    // A flat wait per lap: puppeteer reads a zero timeout as no timeout at all
    for (let lap = 0; lap < CEILING_MS / CADENCE_MS; lap++) {
      // The route can start between the last wait and this dispatch
      await comeBackIntoView(page).catch((error) => {
        if (!/context was destroyed/i.test(error.message)) throw error;
      });

      const routed = await page.waitForFunction(
        () => /^\/(signin|signup)/.test(window.location.pathname),
        { timeout: CADENCE_MS },
      ).then(() => true, (error) => {
        if (error.name !== 'TimeoutError') throw error;
        return false;
      });
      if (routed) {
        return page.url();
      }
    }

    // An 'alive' probe logs nothing, so no line means none came back gone or unknown
    const verdict = probeLine ? `last probe line: ${probeLine}` : 'no probe line was logged';
    throw new Error(`the tab stayed signed in for ${CEILING_MS / 1000} s; ${verdict}`);
  } finally {
    page.off('console', onConsole);
  }
}

module.exports = { waitForSignOutAtDoubt };
