// The background row's ctx inside the live service worker: waitFor polls a
// condition the worker flips, and a runtime skip reports its reason.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'background',
  description: 'background ctx: waitFor and skip in the worker',
  tests: [
    {
      name: 'case-170 ctx.waitFor resolves a condition that turns true on the worker',
      run: async (ctx) => {
        let ready = false;
        setTimeout(() => { ready = true; }, 50);
        const value = await ctx.waitFor(() => ready && 'ready', 2000, 10);
        ctx.expect(value).toBe('ready');
        ctx.expect(typeof chrome.runtime.id).toBe('string');
      },
    },
    {
      name: 'case-170 ctx.skip(why) reports the case skipped with its reason',
      run: async (ctx) => {
        ctx.skip('why');
      },
    },
  ],
});
