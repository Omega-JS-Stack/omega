const defineCases = require('../../../../../../src/test/define-cases.js');
const { recordCwd } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'cwd without',
  tests: [
    { name: 'records its cwd with no root cwd', run: () => recordCwd('without-cwd') },
  ],
});
