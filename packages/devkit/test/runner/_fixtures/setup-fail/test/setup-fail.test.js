const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

const record = (line) => fs.appendFileSync(process.env.FIXTURE_OUT, `${line}\n`);

module.exports = defineCases({
  type: 'group',
  description: 'setup throws',
  setup() {
    throw new Error('setup boom');
  },
  cleanup: () => record('cleanup'),
  tests: [
    { name: 'one', run: () => record('body') },
    { name: 'two', run: () => record('body') },
    { name: 'three', run: () => record('body') },
  ],
});
