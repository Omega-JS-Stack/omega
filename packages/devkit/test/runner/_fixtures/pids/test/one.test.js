const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'pid one',
  tests: [
    { name: 'records pid one', run: () => fs.appendFileSync(process.env.FIXTURE_OUT, `${process.pid}\n`) },
  ],
});
