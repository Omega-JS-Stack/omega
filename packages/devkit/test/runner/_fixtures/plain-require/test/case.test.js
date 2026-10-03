const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

const spec = {
  type: 'group',
  description: 'required by a plain script',
  tests: [
    {
      name: 'must never register',
      run(ctx) {
        fs.appendFileSync(process.env.FIXTURE_OUT, 'registered case ran\n');
        ctx.expect(1).toBe(2);
      },
    },
  ],
};

module.exports = { spec, exported: defineCases(spec) };
