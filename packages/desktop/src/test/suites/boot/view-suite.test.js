// A boot suite bound to a project VIEW (`view: 'main'`), run against the bundled fixture
// consumer: the page under assertion is `fixtures/consumer-app/src/views/main/index.html`
// as BUILT, opened in a real window of the booted fixture app with its own preload.
// `run` bodies are serialized into the page: `ctx` (its `page` is the window) only.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  view: 'main',
  description: 'view suite: the fixture consumer main view (real page, real preload)',
  tests: [
    {
      name: 'case-165 ctx.page is the opened view window',
      run: (ctx) => {
        ctx.expect(ctx.page === window).toBe(true);
        ctx.expect(ctx.page.location.pathname.includes('/views/main/')).toBe(true);
      },
    },

    {
      name: 'the fixture view markup is the page, not the harness page',
      run: (ctx) => {
        ctx.expect(Boolean(ctx.page.document.getElementById('fixture-root'))).toBe(true);
        ctx.expect(Boolean(ctx.page.document.querySelector('p.text-muted'))).toBe(true);
      },
    },

    {
      // config/omega.json5 declares brand.name and no app.productName, so the build
      // templates the derived product name into the heading.
      name: 'the heading carries the fixture configured product name',
      run: (ctx) => {
        ctx.expect(ctx.page.document.querySelector('h1').textContent.trim()).toBe('Desktop Fixture Consumer');
      },
    },

    {
      // The fixture's own src/preload.js, not the renderer harness preload.
      name: 'the project preload exposed window.desktop to the page',
      run: (ctx) => {
        ctx.expect(typeof ctx.page.desktop).toBe('object');
        ctx.expect(typeof ctx.page.desktop.storage).toBe('object');
        ctx.expect(typeof ctx.page.desktop.storage.get).toBe('function');
      },
    },
  ],
});
