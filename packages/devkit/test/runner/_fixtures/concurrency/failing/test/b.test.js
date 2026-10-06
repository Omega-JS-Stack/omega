const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'failing b',
  tests: [
    { name: 'b fails on purpose', run: (ctx) => ctx.expect(1, 'deliberate mismatch').toBe(2) },
  ],
});
