const defineCases = require('../../../../../../src/test/define-cases.js');
const { recordCwd } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'cwd with',
  tests: [
    { name: 'records its cwd under a root cwd', run: () => recordCwd('with-cwd') },
  ],
});
