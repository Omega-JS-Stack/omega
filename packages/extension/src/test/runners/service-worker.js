/**
 * Attach the extension's LIVE service worker for the background lane.
 *
 * A worker that restarts while an old client stays attached pauses on start,
 * and the old handle hangs or reads a torn-down `chrome`. So each attach opens a
 * fresh CDP session, releases any start pause, and proves `chrome.runtime.id`.
 */

// One probe's ceiling; a stopped worker never answers, so the attempt is bounded.
const PROBE_TIMEOUT_MS = 1000;
const POLL_INTERVAL_MS = 100;

/**
 * Open a CDP session on the extension's service worker once it answers live.
 * @param {object} browser - Puppeteer Browser
 * @param {string} extId - the extension id the worker must report
 * @param {number} timeoutMs - how long to wait for a live worker
 * @returns {Promise<object>} a CDPSession on the live worker; the caller detaches it
 */
async function attachLiveWorker(browser, extId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const isOurs = (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`);

  while (Date.now() < deadline) {
    const target = browser.targets().filter(isOurs).pop();
    if (target) {
      const session = await within(target.createCDPSession(), PROBE_TIMEOUT_MS).catch(() => null);
      if (session) {
        const id = await within(probeId(session), PROBE_TIMEOUT_MS).catch(() => null);
        if (id === extId) return session;
        // The worker is not live, so its session may already be gone with it.
        await session.detach().catch(() => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`service worker for ${extId} is not active`);
}

async function probeId(session) {
  await session.send('Runtime.runIfWaitingForDebugger');
  const { result } = await session.send('Runtime.evaluate', {
    expression: `typeof chrome === 'object' && chrome && chrome.runtime ? chrome.runtime.id : null`,
    returnByValue: true,
  });
  return result.value;
}

function within(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { attachLiveWorker };
