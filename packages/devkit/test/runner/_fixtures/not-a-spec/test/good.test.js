const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'good file',
  tests: [
    { name: 'good case', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
