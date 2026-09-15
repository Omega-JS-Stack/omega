importScripts('/build.js');

// BXM fixture consumer — pretends to be a real BXM-based extension's background.
// Boot tests verify this SW comes up cleanly and exposes a couple of probe hooks.
//
// Line 1 above is what a real service worker's first line is
// ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)): the ONE build.js
// the build writes, loaded before anything reads OMEGA_BUILD_JSON. The fixture
// stands in for a REAL built extension, so it loads the snapshot the same way;
// build/build-json-bake.test.js pins that against the live writer, so the boot
// lane can never drift into testing a shape the build no longer emits.

globalThis.__bxmFixtureBooted = true;
globalThis.__bxmFixtureBootedAt = Date.now();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fixture:hello') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  return false;
});

console.log('[extension-fixture] background ready');
