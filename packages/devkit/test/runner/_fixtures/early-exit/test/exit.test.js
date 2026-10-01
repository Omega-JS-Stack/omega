const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'early exit',
  tests: [
    { name: 'before the exit', run: (ctx) => ctx.expect(1).toBe(1) },
    { name: 'calls process.exit', run: () => process.exit(0) },
    { name: 'after the exit', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
