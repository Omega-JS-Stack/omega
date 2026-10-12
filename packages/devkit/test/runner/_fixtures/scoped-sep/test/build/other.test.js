const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  description: 'nested other',
  run: (ctx) => ctx.expect(1).toBe(1),
});
