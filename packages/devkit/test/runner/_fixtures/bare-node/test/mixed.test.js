const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'bare node fixture',
  tests: [
    {
      name: 'bare passing case',
      run(ctx) {
        fs.appendFileSync(process.env.FIXTURE_OUT, 'passing case ran\n');
        ctx.expect(1).toBe(1);
      },
    },
    {
      name: 'bare failing case',
      run(ctx) {
        ctx.expect(1).toBe(2);
      },
    },
  ],
});
