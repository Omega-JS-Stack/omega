const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  description: 'case-111',
  tests: [
    {
      name: 'a',
      run: (ctx) => {
        ctx.expect(1).toBe(1);
      },
    },
  ],
});
