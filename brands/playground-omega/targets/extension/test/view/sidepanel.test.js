/**
 * View-layer UI test: this project's side panel, on the real DOM.
 *
 * The create form is wired end to end: a real submit goes through FormManager,
 * over the messenger to the real background, and background's answer lands on
 * the page. A fresh test profile is signed out, so that answer is the refusal,
 * shown as the form's error, and nothing reaches the API.
 * The test body runs inside the page and closes over nothing, so it carries its own wait.
 */

const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  layer: 'view',
  view: 'sidepanel',
  description: 'the side panel: a signed-out submit shows background\'s refusal',
  run: async (ctx) => {
    const until = async (check, what) => {
      const deadline = Date.now() + 20000;
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    // FormManager marks the form ready once it owns the submit
    await until(() => document.querySelector('#notes-form[data-form-state="ready"]'), 'the form to be ready');

    const $text = document.getElementById('note-text');
    $text.value = 'a note from the view test';
    $text.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('notes-form').requestSubmit();

    await until(() => [...document.querySelectorAll('.alert-danger')]
      .some(($alert) => $alert.textContent.includes('Sign in to use notes.')), 'background\'s refusal');

    ctx.expect(document.getElementById('notes-list').closest('[hidden]') !== null).toBe(true);
  },
});
