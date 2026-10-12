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

const { defineCases } = require('@omega.js/extension/test');

const SETTLE = { timeout: 30000 };

module.exports = defineCases({
  type: 'suite',
  layer: 'boot',
  timeout: 45000,
  description: 'options + content: "save selection as note" (packaged)',
  tests: [
    {
      name: 'the options switch saves notes.autoSaveSelection to the extension store',
      run: async (ctx) => {
        await ctx.page.goto(ctx.extension.optionsUrl, { waitUntil: 'domcontentloaded' });

        // Enabled once it shows the stored value and its listener is attached
        await ctx.page.waitForSelector('#auto-save-selection:not([disabled])', SETTLE);
        ctx.expect(await ctx.page.$eval('#auto-save-selection', ($toggle) => $toggle.checked)).toBe(false);

        await ctx.page.click('#auto-save-selection');
        await ctx.page.waitForFunction(() => document.getElementById('auto-save-status').textContent.startsWith('Saved.'), SETTLE);

        const stored = await ctx.page.evaluate(() => chrome.storage.sync.get('notes.autoSaveSelection'));
        ctx.expect(stored['notes.autoSaveSelection']).toBe(true);
      },
    },
    {
      name: 'on the brand site, a selection shows the button and its save reaches background',
      run: async (ctx) => {
        const build = require('@omega.js/extension/build');
        const brandUrl = `${new URL(build.getConfig().brand.url).origin}/`;

        await ctx.page.setRequestInterception(true);
        ctx.page.on('request', (request) => {
          if (request.url() === brandUrl) {
            request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><p id="text">a sentence worth keeping</p>' });
          } else {
            request.abort();
          }
        });

        await ctx.page.goto(brandUrl, { waitUntil: 'domcontentloaded' });

        // The content script reads the setting the previous test saved, then adds its button
        await ctx.page.waitForSelector('.notes-save-selection', SETTLE);

        await ctx.page.evaluate(() => {
          const range = document.createRange();
          range.selectNodeContents(document.getElementById('text'));
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
        await ctx.page.waitForSelector('.notes-save-selection:not([hidden])', SETTLE);

        await ctx.page.evaluate(() => document.querySelector('.notes-save-selection')
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));

        await ctx.page.waitForFunction(() => document.querySelector('.notes-save-selection').textContent === 'Sign in to use notes.', SETTLE);
        ctx.expect(await ctx.page.$eval('.notes-save-selection', ($button) => $button.textContent)).toBe('Sign in to use notes.');
      },
    },
  ],
});
