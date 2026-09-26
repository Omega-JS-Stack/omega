/**
 * Boot-layer UI test: the packaged side panel, on the real DOM.
 *
 * The create form is wired end to end: a real submit goes through FormManager,
 * over the messenger to the real background, and background's answer lands on
 * the page. A fresh test profile is signed out, so that answer is the refusal,
 * shown as the form's error, and nothing reaches the API.
 */

const SETTLE = { timeout: 30000 };

module.exports = {
  layer: 'boot',
  description: 'the side panel: a signed-out submit shows background\'s refusal',
  inspect: async ({ extension, page, expect }) => {
    await page.goto(`chrome-extension://${extension.id}/views/sidepanel/index.html`, { waitUntil: 'domcontentloaded' });

    // FormManager marks the form ready once it owns the submit
    await page.waitForSelector('#notes-form[data-form-state="ready"]', SETTLE);

    await page.type('#note-text', 'a note from the boot test');
    await page.evaluate(() => document.getElementById('notes-form').requestSubmit());

    await page.waitForFunction(() => [...document.querySelectorAll('.alert-danger')]
      .some(($alert) => $alert.textContent.includes('Sign in to use notes.')), SETTLE);

    const listHidden = await page.evaluate(() => document.getElementById('notes-list').closest('[hidden]') !== null);

    expect(listHidden).toBe(true);
  },
};
