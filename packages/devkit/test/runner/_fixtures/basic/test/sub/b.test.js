const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'second file',
  tests: [
    { name: 'beta one', run: (ctx) => ctx.expect('b').toBe('b') },
    { name: 'beta two', run: (ctx) => ctx.expect(2).toBeGreaterThan(1) },
  ],
});
