/**
 * Boot-layer test: the options page's setting, and the content script that
 * reads it, in the packaged extension.
 *
 * The content script is injected on the brand's own site only. The brand page
 * is served by request interception, so no request leaves the machine: the
 * browser still sees the brand URL, and injects the script as it would there.
 * A fresh test profile is signed out, so the save ends in background's refusal,
 * shown on the button.
 */

const SETTLE = { timeout: 30000 };

module.exports = {
  type: 'suite',
  layer: 'boot',
  description: 'options + content: "save selection as note" (packaged)',
  tests: [
    {
      description: 'the options switch saves notes.autoSaveSelection to the extension store',
      inspect: async ({ extension, page, expect }) => {
        await page.goto(extension.optionsUrl, { waitUntil: 'domcontentloaded' });

        // Enabled once it shows the stored value and its listener is attached
        await page.waitForSelector('#auto-save-selection:not([disabled])', SETTLE);
        expect(await page.$eval('#auto-save-selection', ($toggle) => $toggle.checked)).toBe(false);

        await page.click('#auto-save-selection');
        await page.waitForFunction(() => document.getElementById('auto-save-status').textContent.startsWith('Saved.'), SETTLE);

        const stored = await page.evaluate(() => chrome.storage.sync.get('notes.autoSaveSelection'));
        expect(stored['notes.autoSaveSelection']).toBe(true);
      },
    },
    {
      description: 'on the brand site, a selection shows the button and its save reaches background',
      inspect: async ({ page, expect }) => {
        const build = require('@omega.js/extension/build');
        const brandUrl = `${new URL(build.getConfig().brand.url).origin}/`;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (request.url() === brandUrl) {
            request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><p id="text">a sentence worth keeping</p>' });
          } else {
            request.abort();
          }
        });

        await page.goto(brandUrl, { waitUntil: 'domcontentloaded' });

        // The content script reads the setting the previous test saved, then adds its button
        await page.waitForSelector('.notes-save-selection', SETTLE);

        await page.evaluate(() => {
          const range = document.createRange();
          range.selectNodeContents(document.getElementById('text'));
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
        await page.waitForSelector('.notes-save-selection:not([hidden])', SETTLE);

        await page.evaluate(() => document.querySelector('.notes-save-selection')
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));

        await page.waitForFunction(() => document.querySelector('.notes-save-selection').textContent === 'Sign in to use notes.', SETTLE);
        expect(await page.$eval('.notes-save-selection', ($button) => $button.textContent)).toBe('Sign in to use notes.');
      },
    },
  ],
};
