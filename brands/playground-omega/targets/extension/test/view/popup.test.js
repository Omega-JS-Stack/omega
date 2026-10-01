/**
 * View-layer UI test: this project's popup, on the real DOM.
 *
 * `view: 'popup'` opens the built views/popup/index.html inside the packaged
 * extension. A fresh test profile is signed out, which is the state asserted.
 * Test bodies run inside the page and close over nothing, so each carries its own wait.
 */

const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  type: 'group',
  layer: 'view',
  view: 'popup',
  description: 'the popup (real DOM)',
  tests: [
    {
      name: 'signed out: the sign-in block shows, the account block stays hidden, and background\'s count is drawn',
      run: async (ctx) => {
        const until = async (check, what) => {
          const deadline = Date.now() + 20000;
          while (!(await check())) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        };

        // Both bindings land once auth settles and the popup's code has run
        await until(() => !document.getElementById('popup-signed-out').hidden, 'the signed-out block');
        await until(() => document.getElementById('notes-count').textContent === '0', 'background\'s count');

        ctx.expect(document.getElementById('popup-signed-in').hidden).toBe(true);
        ctx.expect(Boolean(document.querySelector('#popup-signed-out .omega-signin'))).toBe(true);
      },
    },
    {
      name: '"Open notes" opens the pages dashboard in a tab',
      run: async (ctx) => {
        const until = async (check, what) => {
          const deadline = Date.now() + 20000;
          while (!(await check())) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        };

        // The count is drawn in the same turn the click listener is attached
        await until(() => document.getElementById('notes-count').textContent === '0', 'background\'s count');
        document.getElementById('open-notes').click();

        const url = chrome.runtime.getURL('views/pages/index.html');
        let tabs = [];
        await until(async () => {
          tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
          return tabs.length > 0;
        }, `a tab on ${url}`);

        ctx.expect(tabs[0].documentUrl).toBe(url);
        await chrome.tabs.remove(tabs[0].tabId);
      },
    },
  ],
});
