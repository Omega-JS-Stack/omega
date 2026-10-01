const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'first file',
  tests: [
    { name: 'alpha case', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
