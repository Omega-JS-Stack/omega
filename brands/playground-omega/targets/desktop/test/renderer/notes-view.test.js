/**
 * Renderer-layer test: the notes panel of this project's OWN main view, in a
 * real window with the real preload and the real main process behind it.
 *
 * Real events on the real DOM: a submit through FormManager, and an app-store
 * write whose change broadcast the page follows. The boot profile is signed
 * out, so the submit is refused before any request.
 *
 * NOTE: `run` bodies are serialized into the page, so they close over nothing
 * from this module (the poll helper is inlined per test).
 */

module.exports = {
  type: 'group',
  layer: 'renderer',
  view: 'main',
  description: 'the main view\'s notes panel (real page, real preload)',
  tests: [
    {
      name: 'signed out: the sign-in line shows and the list stays hidden',
      run: async (ctx) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            if (fn()) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return false;
        };

        ctx.expect(await poll(() => !document.getElementById('notes-signed-out').hidden)).toBe(true);
        ctx.expect(document.getElementById('notes-signed-in').hidden).toBe(true);
        ctx.expect(document.getElementById('notes-list').closest('[hidden]') !== null).toBe(true);
      },
    },

    {
      name: 'a submit while signed out shows the refusal and sends nothing',
      run: async (ctx) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            if (fn()) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return false;
        };
        const $form = document.getElementById('notes-form');

        // FormManager marks the form ready once it owns the submit
        ctx.expect(await poll(() => $form.getAttribute('data-form-state') === 'ready')).toBe(true);

        document.getElementById('note-text').value = 'a note from the renderer test';
        $form.requestSubmit();

        const refused = await poll(() => [...document.querySelectorAll('.alert-danger')]
          .some(($alert) => $alert.textContent.includes('Sign in to save notes.')));

        ctx.expect(refused).toBe(true);
      },
    },

    {
      name: 'the count follows the app store: a write shows, a delete falls back to 0',
      run: async (ctx) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            if (fn()) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return false;
        };
        const count = () => document.getElementById('notes-count').textContent;

        // The first paint reads the store; the form's readiness means the
        // change listener is attached too
        ctx.expect(await poll(() => document.getElementById('notes-form').getAttribute('data-form-state') === 'ready')).toBe(true);

        await window.desktop.storage.set('notes.count', 7);
        ctx.expect(await poll(() => count() === '7')).toBe(true);

        await window.desktop.storage.delete('notes.count');
        ctx.expect(await poll(() => count() === '0')).toBe(true);
      },
    },
  ],
};
