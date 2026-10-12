// The view row's ctx on the harness popup: ctx.page is the page's own window.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'view',
  context: 'popup',
  description: 'view ctx: ctx.page on the harness popup',
  tests: [
    {
      name: 'case-171 ctx.page is window, on popup.html',
      run: async (ctx) => {
        ctx.expect(ctx.page).toBe(window);
        ctx.expect(ctx.page.location.pathname.endsWith('popup.html')).toBe(true);
      },
    },
  ],
});
