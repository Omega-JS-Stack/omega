const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'suite naming no layer',
  tests: [
    { name: 'default layer case', run: (ctx) => ctx.expect(ctx.layer).toBe('build') },
  ],
});
