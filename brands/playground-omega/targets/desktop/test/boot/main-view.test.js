/**
 * This project's OWN main view, in a real window of the booted app.
 *
 * `layer: 'boot'` with `view: 'main'` opens `src/views/main/index.html` (built)
 * in the staged app, so the page carries this project's real preload, IPC
 * handlers and config: the heading esbuild templated from `app.productName`,
 * the two buttons `src/assets/js/components/main/index.js` wires, and the
 * preload's `window.desktop`.
 *
 * NOTE: `run` bodies are serialized into the page, so they close over nothing
 * from this module: `ctx` (its `page` is the window) and the page globals.
 */

const { defineCases } = require('@omega.js/desktop/test');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  view: 'main',
  description: 'the main view (real page, real preload)',
  tests: [
    {
      name: 'the heading renders this brand product name',
      run: (ctx) => {
        const h1 = document.querySelector('h1');

        ctx.expect(Boolean(h1)).toBe(true);
        ctx.expect(h1.textContent.trim()).toBe('OMEGA Playground');
      },
    },

    {
      name: 'both of the buttons this view ships are on the page',
      run: (ctx) => {
        const getStarted = document.getElementById('get-started');
        const openDocs   = document.getElementById('open-docs');

        ctx.expect(Boolean(getStarted)).toBe(true);
        ctx.expect(getStarted.tagName).toBe('BUTTON');
        ctx.expect(Boolean(openDocs)).toBe(true);
        ctx.expect(openDocs.tagName).toBe('BUTTON');
      },
    },

    {
      name: 'this project preload exposed window.desktop to the page',
      run: (ctx) => {
        ctx.expect(typeof window.desktop).toBe('object');
        ctx.expect(Boolean(window.desktop)).toBe(true);
      },
    },
  ],
});
