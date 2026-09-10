// Build-layer tests for the time-limited command runner. The real limit is
// minutes; the mechanism is proven with a one-second one against a real child
// that would sit for 30s.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { execWithLimit } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'exec-with-limit.js'));

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'exec-with-limit — a child that never returns is rejected at the limit and terminated',
  tests: [
    {
      name: 'the limit rejects on its own timer, naming the label and the seconds',
      run: async (ctx) => {
        const started = Date.now();

        let threw;
        try {
          await execWithLimit('node -e "setTimeout(function () {}, 30000)"', { limitMs: 1000, label: 'signtool' });
        } catch (e) { threw = e; }

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toBe('signtool produced no verdict within 1s and was terminated');
        // Rejected at the limit, not at the child's leisure.
        ctx.expect(Date.now() - started).toBeLessThan(5000);
      },
    },
    {
      name: 'a child that returns in time is untouched, output and all',
      run: async (ctx) => {
        ctx.expect(await execWithLimit('node -e "process.stdout.write(\'ok\')"', { limitMs: 10000 })).toBe('ok');

        // The child's own failure is the child's own error.
        let threw;
        try {
          await execWithLimit('node -e "console.error(\'bad input\'); process.exit(2)"', { limitMs: 10000 });
        } catch (e) { threw = e; }
        ctx.expect(threw.message).toMatch(/bad input/);
      },
    },
    {
      name: 'a missing limit is a programmer error, refused up front',
      run: (ctx) => {
        let threw;
        try { execWithLimit('node -v', {}); } catch (e) { threw = e; }
        ctx.expect(threw.message).toMatch(/positive limitMs/);
      },
    },
  ],
});
