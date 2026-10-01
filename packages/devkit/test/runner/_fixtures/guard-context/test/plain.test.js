const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'inherited test context',
  tests: [
    { name: 'plain passing case', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
