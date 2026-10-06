const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'output beta',
  tests: [
    { name: 'beta case', run: () => process.stdout.write('BETA LINE\n') },
  ],
});
