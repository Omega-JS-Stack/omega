const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'never runs',
  tests: [
    { name: 'must not run', run: () => fs.writeFileSync(process.env.FIXTURE_OUT, 'ran\n') },
  ],
});
