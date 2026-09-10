// Build-layer test for lib/extension.js — verifies the safe-fallback behavior.
// When `chrome` / `window` / `browser` globals are absent (Node context), the
// module's per-API try/catch blocks must swallow the ReferenceError and leave
// every API property set to null. This is how the same module imports cleanly
// in background SW, content scripts, AND build-time Node tooling.

const path = require('path');

const ext = require(path.join(__dirname, '..', '..', '..', 'lib', 'extension.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'lib/extension — safe-fallback in Node context',
  tests: [
    {
      name: 'module exports an object',
      run: (ctx) => {
        ctx.expect(typeof ext).toBe('object');
        ctx.expect(ext).not.toBeNull();
      },
    },
    {
      name: 'common API slots are null when no chrome global is present',
      run: (ctx) => {
        ctx.expect(ext.runtime).toBeNull();
        ctx.expect(ext.storage).toBeNull();
        ctx.expect(ext.tabs).toBeNull();
        ctx.expect(ext.action).toBeNull();
      },
    },
    {
      name: 'requiring the module did not throw (smoke)',
      run: (ctx) => {
        // The fact that we reached this test means require() didn't throw —
        // record an explicit pass so the suite output documents the property.
        ctx.expect(true).toBe(true);
      },
    },
    {
      // wave-5 F8: the window[api] probe ran AFTER the chrome probe and won —
      // in any DOM context window.history (the page's History object) shadowed
      // chrome.history even when the extension held the permission.
      name: 'chrome API wins over a window global of the same name (history shadow)',
      run: (ctx) => {
        const modPath = require.resolve(path.join(__dirname, '..', '..', '..', 'lib', 'extension.js'));
        const chromeHistory = { search: () => [] };
        global.chrome = { history: chromeHistory };
        global.window = { history: { back: () => {} } }; // DOM History imposter
        delete require.cache[modPath];
        try {
          const fresh = require(modPath);
          ctx.expect(fresh.history).toBe(chromeHistory);
        } finally {
          delete global.chrome;
          delete global.window;
          delete require.cache[modPath]; // next require re-resolves in a clean Node context
        }
      },
    },
    {
      // wave-5 F8: `self.api = browser.extension[api]` (literal `.api` typo) —
      // the browser.extension fallback never landed on the named slot.
      name: 'browser.extension fallback lands on the named API slot (typo pin)',
      run: (ctx) => {
        const modPath = require.resolve(path.join(__dirname, '..', '..', '..', 'lib', 'extension.js'));
        const extTabs = { query: () => [] };
        global.browser = { extension: { tabs: extTabs } };
        delete require.cache[modPath];
        try {
          const fresh = require(modPath);
          ctx.expect(fresh.tabs).toBe(extTabs);
          ctx.expect(fresh.api).toBeUndefined(); // the junk `.api` property must not exist
        } finally {
          delete global.browser;
          delete require.cache[modPath];
        }
      },
    },
  ],
});
