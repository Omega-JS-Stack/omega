const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'extended mode',
  tests: [
    {
      name: 'records TEST_EXTENDED_MODE',
      run: () => fs.writeFileSync(process.env.FIXTURE_OUT, JSON.stringify({ value: process.env.TEST_EXTENDED_MODE ?? null })),
    },
  ],
});
