const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'hidden file',
  tests: [
    { name: 'gamma case', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
