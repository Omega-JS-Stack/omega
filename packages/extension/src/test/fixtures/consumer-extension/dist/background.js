(function(){var __omegaBuildJson={"timestamp":"2026-09-01T00:00:00.000Z","repo":{"user":"fixture","name":"fixture"},"environment":"development","license":{"status":"keyless","payments":"gated","attribution":"shown"},"packages":{"@omega.js/extension":"0.1.0"},"config":{"runtime":"browser-extension","version":"0.1.0","environment":"development","brand":{"id":"bxm-fixture","name":"BXM Fixture Consumer"},"omega":{"environment":"development","cache_breaker":1788300000}}};if(typeof globalThis!=='undefined'){globalThis.OMEGA_BUILD_JSON=__omegaBuildJson;}if(typeof self!=='undefined'){self.OMEGA_BUILD_JSON=__omegaBuildJson;}if(typeof window!=='undefined'){window.OMEGA_BUILD_JSON=__omegaBuildJson;}})();
// BXM fixture consumer — pretends to be a real BXM-based extension's background.
// Boot tests verify this SW comes up cleanly and exposes a couple of probe hooks.
//
// Line 1 above is what the bundle task's `buildJsonBanner` prepends to every
// emitted bundle ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)) —
// the fixture stands in for a REAL built extension, so it carries the bake the
// same way a real one does. build/build-json-bake.test.js pins that line against
// the live generator, so the boot lane can never drift into testing a hand-rolled
// shape the build no longer emits.

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
