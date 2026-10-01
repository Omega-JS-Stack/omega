const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'backend target fixture with no emulator',
  tests: [
    { name: 'would need the emulator', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
