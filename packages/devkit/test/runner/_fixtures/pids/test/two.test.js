const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'pid two',
  tests: [
    { name: 'records pid two', run: () => fs.appendFileSync(process.env.FIXTURE_OUT, `${process.pid}\n`) },
  ],
});
