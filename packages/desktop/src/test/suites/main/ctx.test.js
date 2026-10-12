// Main-layer tests for the ctx every main case receives: the booted instance,
// the shared helpers, and a runtime skip the runner reports with its reason.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'main',
  description: 'main ctx',
  tests: [
    {
      name: 'case-163 ctx.omega is the initialized main instance',
      run: (ctx) => {
        ctx.expect(ctx.omega._initialized).toBe(true);
      },
    },
    {
      name: 'case-163 ctx.waitFor is a function that resolves the first truthy value',
      run: async (ctx) => {
        ctx.expect(ctx.waitFor).toBeTypeOf('function');
        let calls = 0;
        ctx.expect(await ctx.waitFor(() => (++calls === 2 ? 'ready' : null), 1000, 10)).toBe('ready');
      },
    },
    {
      // The verifier reads this one off the Results block: skipped, reason `why`.
      name: 'case-163 a case that calls ctx.skip reports skipped with its reason',
      run: (ctx) => {
        ctx.skip('why');
      },
    },
  ],
});
