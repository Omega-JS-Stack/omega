const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'scoped library fixture',
  tests: [
    {
      name: 'scoped library case',
      run(ctx) {
        fs.appendFileSync(process.env.FIXTURE_OUT, 'library case ran\n');
        ctx.expect(1).toBe(1);
      },
    },
  ],
});
