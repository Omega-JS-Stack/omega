const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'mixed outcomes',
  tests: [
    { name: 'first pass', run: (ctx) => ctx.expect(1).toBe(1) },
    { name: 'second pass', run: (ctx) => ctx.expect([1, 2]).toContain(2) },
    { name: 'fails on purpose', run: (ctx) => ctx.expect(1, 'deliberate mismatch').toBe(2) },
    { name: 'skipped case', skip: 'later', run: (ctx) => ctx.expect(1).toBe(2) },
  ],
});
