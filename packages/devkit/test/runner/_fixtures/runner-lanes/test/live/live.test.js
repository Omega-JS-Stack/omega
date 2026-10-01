const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'lane suite',
  tests: [
    { name: 'live case', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
