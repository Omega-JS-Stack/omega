const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'serial zulu',
  tests: [
    { name: 'zulu runs', run: () => timed('zulu', 400) },
  ],
});
