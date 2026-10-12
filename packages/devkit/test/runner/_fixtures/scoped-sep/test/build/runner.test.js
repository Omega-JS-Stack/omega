const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  description: 'nested runner',
  run: (ctx) => ctx.expect(1).toBe(1),
});
