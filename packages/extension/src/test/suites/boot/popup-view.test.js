// A boot suite naming a built view: its bodies run inside the fixture consumer's
// views/popup/index.html, in the loaded extension, where ctx.page is the page's window.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  view: 'popup',
  timeout: 45000,
  description: 'boot view: a suite naming the popup view runs in the built page',
  tests: [
    {
      name: 'case-172 ctx.page is the window of views/popup/index.html',
      run: async (ctx) => {
        ctx.expect(ctx.page).toBe(window);
        ctx.expect(ctx.page.location.pathname).toBe('/views/popup/index.html');
        ctx.expect(ctx.page.document.querySelector('h1').textContent).toBe('Fixture Popup view');
      },
    },
  ],
});
