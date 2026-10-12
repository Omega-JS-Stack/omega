// Renderer-layer tests for the ctx a harness-page case receives. Bodies are
// serialized into the page: no closures, only `ctx` and the page globals.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'renderer',
  description: 'renderer ctx (harness page)',
  tests: [
    {
      name: 'case-164 ctx.page is the page window',
      run: (ctx) => {
        ctx.expect(ctx.page === window).toBe(true);
      },
    },
    {
      name: 'case-164 ctx.page.document.body exists',
      run: (ctx) => {
        ctx.expect(Boolean(ctx.page.document.body)).toBe(true);
      },
    },
  ],
});
