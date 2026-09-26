/**
 * Boot-layer UI test: the packaged popup, on the real DOM.
 *
 * The view layer runs on the framework's harness pages, not this project's
 * views, so a test of THIS popup loads the packaged one here. A fresh test
 * profile is signed out, which is the state asserted.
 */

const SETTLE = { timeout: 30000 };

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'the popup (packaged, real DOM)',
  tests: [
    {
      description: 'signed out: the sign-in block shows, the account block stays hidden, and background\'s count is drawn',
      inspect: async ({ extension, page, expect }) => {
        await page.goto(extension.popupUrl, { waitUntil: 'domcontentloaded' });

        // Both bindings land once auth settles and the popup's code has run
        await page.waitForFunction(() => !document.getElementById('popup-signed-out').hidden, SETTLE);
        await page.waitForFunction(() => document.getElementById('notes-count').textContent === '0', SETTLE);

        const state = await page.evaluate(() => ({
          signedInHidden: document.getElementById('popup-signed-in').hidden,
          signIn: Boolean(document.querySelector('#popup-signed-out .omega-signin')),
        }));

        expect(state).toEqual({ signedInHidden: true, signIn: true });
      },
    },
    {
      description: '"Open notes" opens the pages dashboard in a tab',
      inspect: async ({ extension, page, expect }) => {
        await page.goto(extension.popupUrl, { waitUntil: 'domcontentloaded' });

        // The count is drawn in the same turn the click listener is attached
        await page.waitForFunction(() => document.getElementById('notes-count').textContent === '0', SETTLE);
        await page.evaluate(() => document.getElementById('open-notes').click());

        const url = `chrome-extension://${extension.id}/views/pages/index.html`;
        const target = await page.browser().waitForTarget((candidate) => candidate.url() === url, { timeout: 10000 });
        const opened = await target.page();

        expect(target.url()).toBe(url);
        await opened.close();
      },
    },
  ],
};
