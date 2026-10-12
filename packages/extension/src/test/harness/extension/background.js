// The test-harness service worker: it stays alive for the background driver to
// attach over CDP and evaluate each suite's payload, whose cases report as
// `__OMEGA_TEST__` console lines. It sets globalThis.OMEGA_TEST_MODE, and answers
// a ping so a view suite can prove the worker is alive.

globalThis.OMEGA_TEST_MODE = true;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'extension:test:ping') {
    sendResponse({ pong: true, ts: Date.now() });
    return false; // sync response
  }
  return false;
});

console.log('[extension-harness] service worker ready');
