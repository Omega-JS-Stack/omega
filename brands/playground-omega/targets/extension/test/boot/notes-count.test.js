/**
 * Boot-layer test: the packaged background answers notes:count.
 *
 * test/build/notes-background.test.js proves the handlers; this proves they
 * survived the bundle and are registered in the real service worker. A fresh
 * test profile has no session, so the answer is the signed-out one and no API
 * call is made.
 */

module.exports = {
  layer: 'boot',
  description: 'the packaged background answers notes:count over the messenger',
  inspect: async ({ extension, page, expect }) => {
    // Any extension page can reach the worker: ask from the popup, the way it asks
    await page.goto(extension.popupUrl, { waitUntil: 'domcontentloaded' });

    const answer = await page.evaluate(() => chrome.runtime.sendMessage({
      sender: 'popup',
      destination: 'background',
      command: 'notes:count',
    }));

    expect(answer).toEqual({ ok: true, count: 0 });
  },
};
