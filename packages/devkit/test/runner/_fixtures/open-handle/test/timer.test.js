const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'open handle',
  tests: [
    {
      name: 'leaves a timer running',
      run(ctx) {
        setInterval(() => {}, 60000);
        ctx.expect(1).toBe(1);
      },
    },
  ],
});
