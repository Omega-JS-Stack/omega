// Boot-layer test: verifies Chromium can load the framework's fixture consumer
// extension as unpacked, the manifest validates, the SW comes up, and the
// popup renders end-to-end. This is the integration equivalent to "did the
// real consumer extension start without throwing".
//
// In the framework's own test run, OMEGA_TEST_BOOT_PROJECT points at the fixture under
// src/test/fixtures/consumer-extension. In a real consumer's `npx omega test`
// run, the env var is unset and boot tests target the consumer's own
// `<cwd>/dist/`.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  timeout: 45000,
  description: 'fixture consumer — extension loads + boots',
  tests: [
    {
      name: 'extension has a valid ID and MV3 manifest',
      run: async (ctx) => {
        ctx.expect(ctx.extension.id).toMatch(/^[a-z]{32}$/);
        ctx.expect(ctx.extension.manifest.manifest_version).toBe(3);
        ctx.expect(ctx.extension.manifest.name).toBe('OMEGA Fixture Consumer');
      },
    },
    {
      name: 'manifest exposes a popup URL',
      run: async (ctx) => {
        ctx.expect(ctx.extension.popupUrl).toMatch(/^chrome-extension:\/\/[a-z]{32}\/popup\.html$/);
      },
    },
    {
      name: 'service worker target was discovered',
      run: async (ctx) => {
        ctx.expect(ctx.extension.swTarget).not.toBeNull();
        ctx.expect(ctx.extension.swTarget.type()).toBe('service_worker');
      },
    },
    {
      name: 'popup.html renders with the expected #main-content element',
      run: async (ctx) => {
        await ctx.page.goto(ctx.extension.popupUrl, { waitUntil: 'domcontentloaded' });
        const text = await ctx.page.$eval('#main-content', (el) => el.textContent);
        ctx.expect(text).toContain('Fixture Popup');
      },
    },
    {
      name: 'background SW responded to a probe message',
      run: async (ctx) => {
        // Open any page that has chrome.runtime access — popup works.
        await ctx.page.goto(ctx.extension.popupUrl, { waitUntil: 'domcontentloaded' });
        const reply = await ctx.page.evaluate(() => chrome.runtime.sendMessage({ type: 'fixture:hello' }));
        ctx.expect(reply.ok).toBe(true);
        ctx.expect(reply.version).toBe('0.1.0');
      },
    },
    {
      name: 'case-172 a run(ctx) boot case reads ctx.extension.id and navigates ctx.page to the popup',
      run: async (ctx) => {
        ctx.expect(ctx.extension.id).toMatch(/^[a-z]{32}$/);
        await ctx.page.goto(ctx.extension.popupUrl, { waitUntil: 'domcontentloaded' });
        ctx.expect(ctx.page.url()).toBe(ctx.extension.popupUrl);
      },
    },
  ],
});
