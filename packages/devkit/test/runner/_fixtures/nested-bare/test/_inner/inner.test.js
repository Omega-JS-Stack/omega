const fs = require('node:fs');
const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'inner suite',
  tests: [
    { name: 'inner case', run: () => fs.appendFileSync(process.env.FIXTURE_OUT, 'inner case ran\n') },
  ],
});
