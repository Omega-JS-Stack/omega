/**
 * Boot-layer test: the packaged background answers notes:count.
 *
 * test/build/notes-background.test.js proves the handlers; this proves they
 * survived the bundle and are registered in the real service worker. A fresh
 * test profile has no session, so the answer is the signed-out one and no API
 * call is made.
 */

const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  layer: 'boot',
  timeout: 45000,
  description: 'the packaged background answers notes:count over the messenger',
  run: async (ctx) => {
    // Any extension page can reach the worker: ask from the popup, the way it asks
    await ctx.page.goto(ctx.extension.popupUrl, { waitUntil: 'domcontentloaded' });

    const answer = await ctx.page.evaluate(() => chrome.runtime.sendMessage({
      sender: 'popup',
      destination: 'background',
      command: 'notes:count',
    }));

    ctx.expect(answer).toEqual({ ok: true, count: 0 });
  },
});
